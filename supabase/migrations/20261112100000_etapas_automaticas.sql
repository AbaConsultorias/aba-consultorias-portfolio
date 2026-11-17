-- Etapas dos projetos a partir das pastas do servidor (docs/ETAPAS-AUTOMATICAS-CONTRATO.md, aprovado em 11/11/2026).
-- 1. Marco das etapas (confeccao, analise, aprovado) em modelo_etapas_itens e projeto_etapas, com preenchimento por nome.
--    criar_projeto_de_modelo passa a copiar o marco. salvar_etapas_projeto_portal e salvar_modelo_portal não mudam:
--    atualizam só nome, ordem e data por id, então o marco existente é preservado e etapa nova nasce sem marco.
-- 2. pasta_regras: tipos 'protocolos' e 'devolutivas' e a coluna sinal (protocolo, devolutiva, aprovado).
-- 3. empreendimentos.etapas_modo (desligado, sugerir, automatico); ligar o automático é só do admin.
-- 4. etapa_sinais: um sinal por PDF confirmado numa regra com sinal. confirmar_envio_conector grava o sinal e, no modo
--    automático, aplica na hora (erro ao aplicar nunca desfaz o documento).
-- 5. projeto_etapa_historico: cada mudança de etapa (trigger), com origem, sinal e as datas que a mudança preencheu.
-- 6. Funções: sugestao_etapa, aplicar_sugestao_etapa, ignorar_sinal_etapa, desfazer_etapa e
--    aplicar_sugestoes_empreendimento. As que escrevem são security definer e conferem a permissão no corpo, porque
--    etapa_sinais e projeto_etapa_historico não têm escrita direta para ninguém (sem grant de insert/update/delete).
-- Nenhuma política existente muda. Desfazer: supabase/reversoes/20261112100000_etapas_automaticas.down.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. Marco das etapas
-- ---------------------------------------------------------------------------

-- Sem acento, minúsculas e sem espaços nas pontas. "Confeccionando ITCD..." não casa: não começa com "em confec".
create function public.marco_da_etapa_por_nome(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n.valor like 'em confec%' then 'confeccao'
    when n.valor like 'em analise%' then 'analise'
    when n.valor = 'aprovado' or n.valor like 'aprovado,%' then 'aprovado'
  end
  from (
    select btrim(lower(regexp_replace(normalize(p_nome, nfd), '[̀-ͯ]', '', 'g'))) as valor
  ) n
$$;

revoke execute on function public.marco_da_etapa_por_nome(text) from public, anon;
grant execute on function public.marco_da_etapa_por_nome(text) to authenticated;

alter table public.modelo_etapas_itens
  add column marco text,
  add constraint modelo_etapas_itens_marco_check check (marco in ('confeccao', 'analise', 'aprovado'));

alter table public.projeto_etapas
  add column marco text,
  add constraint projeto_etapas_marco_check check (marco in ('confeccao', 'analise', 'aprovado'));

-- Se um modelo (ou projeto) tiver duas etapas com o mesmo nome de marco, só a de menor ordem leva o marco: o índice
-- único abaixo não admite repetição e a migration não pode falhar por causa de um cadastro antigo.
with candidatas as (
  select i.id, public.marco_da_etapa_por_nome(i.nome) as marco,
         row_number() over (partition by i.modelo_id, public.marco_da_etapa_por_nome(i.nome) order by i.ordem) as posicao
  from public.modelo_etapas_itens i
)
update public.modelo_etapas_itens i
set marco = c.marco
from candidatas c
where c.id = i.id and c.marco is not null and c.posicao = 1;

with candidatas as (
  select e.id, public.marco_da_etapa_por_nome(e.nome) as marco,
         row_number() over (partition by e.projeto_id, public.marco_da_etapa_por_nome(e.nome) order by e.ordem) as posicao
  from public.projeto_etapas e
)
update public.projeto_etapas e
set marco = c.marco
from candidatas c
where c.id = e.id and c.marco is not null and c.posicao = 1;

create unique index modelo_etapas_itens_marco_idx on public.modelo_etapas_itens (modelo_id, marco) where marco is not null;
create unique index projeto_etapas_marco_idx on public.projeto_etapas (projeto_id, marco) where marco is not null;

-- Mesma função de 20261110110000_ordem_projetos.sql (assinatura, permissão, ordem e grants iguais); a única mudança é
-- copiar o marco da etapa do modelo.
create or replace function public.criar_projeto_de_modelo(p_empreendimento uuid, p_modelo uuid, p_nome text, p_projeto_pai uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
declare
  v_projeto uuid;
  v_primeira_etapa uuid;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Apenas a equipe pode criar projetos.' using errcode = 'insufficient_privilege';
  end if;

  if p_modelo is null then
    raise exception 'O modelo do projeto é obrigatório.' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.projetos (empreendimento_id, modelo_origem_id, nome, projeto_pai_id, ordem)
  values (
    p_empreendimento, p_modelo, p_nome, p_projeto_pai,
    coalesce((
      select max(i.ordem) from public.projetos i
      where i.empreendimento_id = p_empreendimento and i.projeto_pai_id is not distinct from p_projeto_pai
    ), -1) + 1
  )
  returning id into v_projeto;

  insert into public.projeto_etapas (projeto_id, nome, ordem, marco)
  select v_projeto, i.nome, i.ordem, i.marco
  from public.modelo_etapas_itens i
  where i.modelo_id = p_modelo;

  insert into public.projeto_categorias_documento (projeto_id, nome, ordem)
  select v_projeto, c.nome, c.ordem
  from public.modelo_categorias_documento c
  where c.modelo_id = p_modelo;

  select e.id into v_primeira_etapa
  from public.projeto_etapas e
  where e.projeto_id = v_projeto
  order by e.ordem
  limit 1;

  update public.projetos
  set etapa_atual_id = v_primeira_etapa
  where id = v_projeto;

  return v_projeto;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. pasta_regras: tipos protocolos e devolutivas, e o sinal
-- ---------------------------------------------------------------------------

alter table public.pasta_regras
  drop constraint pasta_regras_tipo_check,
  add column sinal text,
  add constraint pasta_regras_tipo_check check (tipo in ('comum', 'equipamentos', 'protocolos', 'devolutivas')),
  add constraint pasta_regras_sinal_valor_check check (sinal in ('protocolo', 'devolutiva', 'aprovado')),
  add constraint pasta_regras_etapas_destino_check check (
    tipo not in ('protocolos', 'devolutivas') or (projeto_id is not null and grupo is null)
  ),
  -- protocolos <=> protocolo, devolutivas <=> devolutiva; aprovado só em regra comum de projeto; equipamentos sem sinal.
  add constraint pasta_regras_sinal_check check (
    (tipo = 'protocolos') = (sinal is not distinct from 'protocolo')
    and (tipo = 'devolutivas') = (sinal is not distinct from 'devolutiva')
    and (sinal is distinct from 'aprovado' or (tipo = 'comum' and projeto_id is not null))
  );

-- Regras ativas que já recebem os aprovados: algum trecho do caminho (sem acento, em maiúsculas) tem APROVAD e o
-- projeto tem etapa de marco aprovado (feito acima).
update public.pasta_regras r
set sinal = 'aprovado'
where r.ativa
  and r.tipo = 'comum'
  and r.projeto_id is not null
  and exists (
    select 1
    from unnest(string_to_array(r.caminho_prefixo, '/')) as s(segmento)
    where upper(regexp_replace(normalize(s.segmento, nfd), '[̀-ͯ]', '', 'g')) like '%APROVAD%'
  )
  and exists (
    select 1 from public.projeto_etapas e where e.projeto_id = r.projeto_id and e.marco = 'aprovado'
  );

-- ---------------------------------------------------------------------------
-- 3. empreendimentos.etapas_modo
-- ---------------------------------------------------------------------------

-- Sem grant por coluna em empreendimentos: o privilégio de tabela já cobre a coluna e a política "empreendimentos.editar
-- atualiza empreendimentos" decide quem muda. O RLS não separa colunas, então o trigger exige o admin para o automático.
alter table public.empreendimentos
  add column etapas_modo text not null default 'desligado',
  add constraint empreendimentos_etapas_modo_check check (etapas_modo in ('desligado', 'sugerir', 'automatico'));

-- Chamada sem usuário (secret key, migration, script) passa; a conferência vale para qualquer sessão de login.
create function public.proteger_modo_etapas_empreendimento()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_antes text;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_antes := old.etapas_modo;
  else
    v_antes := 'desligado';
  end if;

  if new.etapas_modo is distinct from v_antes
     and 'automatico' in (new.etapas_modo, v_antes)
     and not (select public.e_admin()) then
    raise exception 'Só o administrador liga ou desliga as etapas automáticas.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.proteger_modo_etapas_empreendimento() from public, anon, authenticated;

create trigger empreendimentos_proteger_modo_etapas
  before insert or update on public.empreendimentos
  for each row execute function public.proteger_modo_etapas_empreendimento();

-- ---------------------------------------------------------------------------
-- 4. etapa_sinais
-- ---------------------------------------------------------------------------

create table public.etapa_sinais (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  documento_id uuid not null unique references public.documentos (id) on delete cascade,
  tipo text not null check (tipo in ('protocolo', 'devolutiva', 'aprovado')),
  -- Data do arquivo informada pelo servidor (mtime), não a hora em que o site leu.
  data_arquivo timestamptz not null,
  criado_em timestamptz not null default now(),
  ignorado_em timestamptz,
  ignorado_por uuid references public.profiles (id) on delete set null,
  aplicado_em timestamptz
);

create index etapa_sinais_projeto_data_idx on public.etapa_sinais (projeto_id, data_arquivo desc);
create index etapa_sinais_empreendimento_idx on public.etapa_sinais (empreendimento_id);
create index etapa_sinais_ignorado_por_idx on public.etapa_sinais (ignorado_por);

alter table public.etapa_sinais enable row level security;

revoke all on table public.etapa_sinais from anon;
revoke all on table public.etapa_sinais from authenticated;
grant select on table public.etapa_sinais to authenticated;

create policy "empreendimentos.ver lê sinais de etapa"
  on public.etapa_sinais
  for select
  to authenticated
  using ((select public.tem_permissao('empreendimentos.ver')));

-- ---------------------------------------------------------------------------
-- 5. projeto_etapa_historico
-- ---------------------------------------------------------------------------

create table public.projeto_etapa_historico (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  de_etapa_id uuid references public.projeto_etapas (id) on delete set null,
  para_etapa_id uuid references public.projeto_etapas (id) on delete set null,
  origem text not null check (origem in ('manual', 'sugestao', 'automatico', 'recalculo', 'desfazer')),
  sinal_id uuid references public.etapa_sinais (id) on delete set null,
  -- [{"etapa_id", "anterior", "novo"}]: etapas cujo concluida_em esta mudança preencheu, para o desfazer.
  datas_alteradas jsonb not null default '[]'::jsonb check (jsonb_typeof(datas_alteradas) = 'array'),
  por uuid references public.profiles (id) on delete set null default auth.uid(),
  -- clock_timestamp (e não now): duas mudanças na mesma transação continuam em ordem.
  em timestamptz not null default clock_timestamp(),
  desfeito_em timestamptz,
  desfeito_por uuid references public.profiles (id) on delete set null
);

create index projeto_etapa_historico_projeto_em_idx on public.projeto_etapa_historico (projeto_id, em desc);
create index projeto_etapa_historico_de_etapa_idx on public.projeto_etapa_historico (de_etapa_id);
create index projeto_etapa_historico_para_etapa_idx on public.projeto_etapa_historico (para_etapa_id);
create index projeto_etapa_historico_sinal_idx on public.projeto_etapa_historico (sinal_id);
create index projeto_etapa_historico_por_idx on public.projeto_etapa_historico (por);
create index projeto_etapa_historico_desfeito_por_idx on public.projeto_etapa_historico (desfeito_por);

alter table public.projeto_etapa_historico enable row level security;

revoke all on table public.projeto_etapa_historico from anon;
revoke all on table public.projeto_etapa_historico from authenticated;
grant select on table public.projeto_etapa_historico to authenticated;

create policy "empreendimentos.ver lê histórico de etapas"
  on public.projeto_etapa_historico
  for select
  to authenticated
  using ((select public.tem_permissao('empreendimentos.ver')));

-- Security definer: quem muda a etapa não tem insert no histórico. A origem, o sinal e as datas vêm de variáveis de
-- sessão que só as funções abaixo preenchem (set_config local) e limpam logo depois do update; qualquer outro update
-- da etapa é 'manual'. A primeira etapa de um projeto novo (etapa_atual_id nulo -> primeira) não é mudança e não
-- entra: senão o histórico "manual" de criação empurraria a referência do sugestao_etapa para depois de todo arquivo antigo.
create function public.registrar_historico_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origem text := coalesce(nullif(current_setting('aba.etapa_origem', true), ''), 'manual');
begin
  if new.etapa_atual_id is null or (old.etapa_atual_id is null and v_origem = 'manual') then
    return new;
  end if;
  if v_origem not in ('manual', 'sugestao', 'automatico', 'recalculo', 'desfazer') then
    v_origem := 'manual';
  end if;

  insert into public.projeto_etapa_historico (projeto_id, de_etapa_id, para_etapa_id, origem, sinal_id, datas_alteradas, por)
  values (
    new.id, old.etapa_atual_id, new.etapa_atual_id, v_origem,
    nullif(current_setting('aba.etapa_sinal', true), '')::uuid,
    coalesce(nullif(current_setting('aba.etapa_datas', true), ''), '[]')::jsonb,
    (select auth.uid())
  );

  return new;
end;
$$;

revoke execute on function public.registrar_historico_etapa() from public, anon, authenticated;

create trigger projetos_registrar_historico_etapa
  after update of etapa_atual_id on public.projetos
  for each row
  when (old.etapa_atual_id is distinct from new.etapa_atual_id)
  execute function public.registrar_historico_etapa();

-- ---------------------------------------------------------------------------
-- 6. Funções
-- ---------------------------------------------------------------------------

-- Cálculo da sugestão, sem conferir permissão: é chamado por sugestao_etapa (como quem clicou, então o RLS vale) e pelas
-- funções definer abaixo. Referência = a data mais recente entre as mudanças ainda valendo do projeto (a data do arquivo
-- quando a mudança veio de um sinal; a hora da mudança quando foi manual). Os registros 'desfazer' ficam de fora: eles
-- só devolvem o estado de antes, e assim o sinal desfeito volta a ser sugerido (a pessoa pode ignorá-lo).
create function public.etapa_sugestao_calcular(p_projeto uuid)
returns table (sinal_id uuid, tipo text, etapa_id uuid, etapa_nome text, data_arquivo timestamptz)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_atual uuid;
  v_atual_ordem integer;
  v_atual_marco text;
  v_aprovado_ordem integer;
  v_referencia timestamptz;
  v_sinal public.etapa_sinais%rowtype;
  v_marco text;
  v_alvo public.projeto_etapas%rowtype;
begin
  select p.etapa_atual_id into v_atual from public.projetos p where p.id = p_projeto;
  if not found then
    return;
  end if;

  select e.ordem, e.marco into v_atual_ordem, v_atual_marco from public.projeto_etapas e where e.id = v_atual;
  select e.ordem into v_aprovado_ordem
    from public.projeto_etapas e
   where e.projeto_id = p_projeto and e.marco = 'aprovado';

  -- Depois de aprovado nada volta sozinho.
  if v_atual_marco = 'aprovado' or (v_aprovado_ordem is not null and v_atual_ordem >= v_aprovado_ordem) then
    return;
  end if;

  select coalesce(max(coalesce(s.data_arquivo, h.em)), '-infinity'::timestamptz) into v_referencia
    from public.projeto_etapa_historico h
    left join public.etapa_sinais s on s.id = h.sinal_id
   where h.projeto_id = p_projeto and h.desfeito_em is null and h.origem <> 'desfazer';

  select s.* into v_sinal
    from public.etapa_sinais s
   where s.projeto_id = p_projeto and s.ignorado_em is null and s.data_arquivo > v_referencia
   order by s.data_arquivo desc,
            case s.tipo when 'aprovado' then 3 when 'devolutiva' then 2 else 1 end desc,
            s.id
   limit 1;
  if not found then
    return;
  end if;

  v_marco := case v_sinal.tipo when 'protocolo' then 'analise' when 'aprovado' then 'aprovado' else 'confeccao' end;
  select e.* into v_alvo from public.projeto_etapas e where e.projeto_id = p_projeto and e.marco = v_marco;
  if not found and v_sinal.tipo = 'devolutiva' then
    select e.* into v_alvo from public.projeto_etapas e where e.projeto_id = p_projeto and e.marco = 'analise';
  end if;
  if v_alvo.id is null or v_alvo.id is not distinct from v_atual then
    return;
  end if;

  return query select v_sinal.id, v_sinal.tipo, v_alvo.id, v_alvo.nome, v_sinal.data_arquivo;
end;
$$;

-- Precisa de execute para authenticated porque sugestao_etapa é invoker e a chama com a permissão de quem clicou.
revoke execute on function public.etapa_sugestao_calcular(uuid) from public, anon;
grant execute on function public.etapa_sugestao_calcular(uuid) to authenticated;

create function public.sugestao_etapa(p_projeto uuid)
returns table (sinal_id uuid, tipo text, etapa_id uuid, etapa_nome text, data_arquivo timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  if not (select public.tem_permissao('empreendimentos.ver')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  return query select * from public.etapa_sugestao_calcular(p_projeto);
end;
$$;

revoke execute on function public.sugestao_etapa(uuid) from public, anon;
grant execute on function public.sugestao_etapa(uuid) to authenticated;

-- Aplica o sinal se ele ainda for a sugestão atual do projeto; devolve o id do histórico gerado, ou null quando não
-- aplicou (projeto inexistente ou sugestão que mudou). Sem conferência de permissão: quem chama confere. Sem grant para
-- ninguém; só aplicar_sugestao_etapa, aplicar_sugestoes_empreendimento e confirmar_envio_conector (todas definer, do
-- mesmo dono) chegam aqui. O 'automatico' só existe por este caminho.
create function public.etapa_aplicar_sinal_interno(p_projeto uuid, p_sinal uuid, p_origem text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sinal_atual uuid;
  v_etapa uuid;
  v_data_arquivo timestamptz;
  v_alvo_ordem integer;
  v_alvo_marco text;
  v_data date;
  v_datas jsonb;
  v_historico uuid;
  v_modo text;
begin
  if p_origem is null or p_origem not in ('sugestao', 'automatico', 'recalculo') then
    raise exception 'Origem inválida.' using errcode = 'P0001';
  end if;
  if p_projeto is null or p_sinal is null then
    return null;
  end if;

  perform 1 from public.projetos p where p.id = p_projeto for update;
  if not found then
    return null;
  end if;

  -- O modo é relido aqui, já com o projeto travado e o empreendimento em FOR SHARE (a troca de modo espera esta
  -- transação): sem isso uma confirmação que leu 'automatico' antes poderia aplicar depois de o admin desligar.
  select e.etapas_modo into v_modo
    from public.projetos p join public.empreendimentos e on e.id = p.empreendimento_id
   where p.id = p_projeto
     for share of e;
  if p_origem = 'automatico' and v_modo is distinct from 'automatico' then
    return null;
  end if;
  if p_origem <> 'automatico' and v_modo = 'desligado' then
    raise exception 'As etapas pelas pastas estão desligadas neste empreendimento.' using errcode = 'P0001';
  end if;

  select s.sinal_id, s.etapa_id, s.data_arquivo into v_sinal_atual, v_etapa, v_data_arquivo
    from public.etapa_sugestao_calcular(p_projeto) s;
  if v_sinal_atual is distinct from p_sinal then
    return null;
  end if;

  select e.ordem, e.marco into v_alvo_ordem, v_alvo_marco from public.projeto_etapas e where e.id = v_etapa;
  -- O escritório é de Minas: o dia do arquivo é o de Brasília, não o do fuso da sessão.
  v_data := (v_data_arquivo at time zone 'America/Sao_Paulo')::date;

  -- Etapas puladas (ordem antes do alvo) e, se o alvo é o aprovado, o próprio alvo recebem a data do arquivo.
  with alteradas as (
    update public.projeto_etapas e
       set concluida_em = v_data
     where e.projeto_id = p_projeto
       and e.concluida_em is null
       and (e.ordem < v_alvo_ordem or (e.id = v_etapa and v_alvo_marco = 'aprovado'))
    returning e.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('etapa_id', a.id, 'anterior', null::date, 'novo', v_data)), '[]'::jsonb)
    into v_datas
    from alteradas a;

  -- Voltar (ex.: LAN de correção leva de "Em análise" para "Em confecção"): a etapa alvo e as seguintes deixam de estar
  -- concluídas. A data antiga fica em datas_alteradas para o desfazer.
  if v_alvo_marco is distinct from 'aprovado' then
    with antes as (
      select e.id, e.concluida_em
        from public.projeto_etapas e
       where e.projeto_id = p_projeto and e.ordem >= v_alvo_ordem and e.concluida_em is not null
         for update
    ), limpas as (
      update public.projeto_etapas e
         set concluida_em = null
        from antes a
       where e.id = a.id
      returning e.id, a.concluida_em as anterior
    )
    select v_datas || coalesce(jsonb_agg(jsonb_build_object('etapa_id', l.id, 'anterior', l.anterior, 'novo', null::date)), '[]'::jsonb)
      into v_datas
      from limpas l;
  end if;

  perform set_config('aba.etapa_origem', p_origem, true);
  perform set_config('aba.etapa_sinal', p_sinal::text, true);
  perform set_config('aba.etapa_datas', v_datas::text, true);
  update public.projetos set etapa_atual_id = v_etapa where id = p_projeto;
  perform set_config('aba.etapa_origem', '', true);
  perform set_config('aba.etapa_sinal', '', true);
  perform set_config('aba.etapa_datas', '', true);

  update public.etapa_sinais set aplicado_em = now() where id = p_sinal;

  select h.id into v_historico
    from public.projeto_etapa_historico h
   where h.projeto_id = p_projeto and h.sinal_id = p_sinal and h.desfeito_em is null and h.origem <> 'desfazer'
   order by h.em desc, h.id
   limit 1;

  return v_historico;
end;
$$;

revoke execute on function public.etapa_aplicar_sinal_interno(uuid, uuid, text) from public, anon, authenticated, service_role;

-- p_origem aceita 'sugestao' (padrão) e 'recalculo'. 'automatico' não: quem o usa é o conector, por dentro.
create function public.aplicar_sugestao_etapa(p_projeto uuid, p_sinal uuid, p_origem text default 'sugestao')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_historico uuid;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_projeto is null or p_sinal is null or p_origem is null or p_origem not in ('sugestao', 'recalculo') then
    raise exception 'Os dados da sugestão são inválidos.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projetos p where p.id = p_projeto) then
    raise exception 'Projeto não encontrado.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.projetos p join public.empreendimentos e on e.id = p.empreendimento_id
              where p.id = p_projeto and e.etapas_modo = 'desligado') then
    raise exception 'As etapas pelas pastas estão desligadas neste empreendimento.' using errcode = 'P0001';
  end if;

  v_historico := public.etapa_aplicar_sinal_interno(p_projeto, p_sinal, p_origem);
  if v_historico is null then
    raise exception 'Esta sugestão não vale mais. Atualize a tela.' using errcode = 'P0001';
  end if;

  return v_historico;
end;
$$;

revoke execute on function public.aplicar_sugestao_etapa(uuid, uuid, text) from public, anon;
grant execute on function public.aplicar_sugestao_etapa(uuid, uuid, text) to authenticated;

create function public.ignorar_sinal_etapa(p_sinal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projeto uuid;
  v_sinal public.etapa_sinais%rowtype;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select s.projeto_id into v_projeto from public.etapa_sinais s where s.id = p_sinal;
  if not found then
    raise exception 'Sinal não encontrado.' using errcode = 'P0001';
  end if;

  perform 1 from public.projetos p where p.id = v_projeto for update;
  select s.* into v_sinal from public.etapa_sinais s where s.id = p_sinal for update;
  if not found then
    raise exception 'Sinal não encontrado.' using errcode = 'P0001';
  end if;
  if v_sinal.aplicado_em is not null then
    raise exception 'Este sinal já foi aplicado.' using errcode = 'P0001';
  end if;
  if v_sinal.ignorado_em is not null then
    return;
  end if;

  update public.etapa_sinais
     set ignorado_em = now(), ignorado_por = (select auth.uid())
   where id = p_sinal;
end;
$$;

revoke execute on function public.ignorar_sinal_etapa(uuid) from public, anon;
grant execute on function public.ignorar_sinal_etapa(uuid) to authenticated;

-- Só o registro mais recente, ainda valendo, de uma mudança vinda de sinal. Os registros 'desfazer' não contam como
-- "mais recente": desfazer o último deixa o penúltimo desfazível. A data só volta se ninguém a mexeu depois.
create function public.desfazer_etapa(p_historico uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.projeto_etapa_historico%rowtype;
  v_atual uuid;
  v_item jsonb;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select h.* into v_h from public.projeto_etapa_historico h where h.id = p_historico;
  if not found then
    raise exception 'Registro do histórico não encontrado.' using errcode = 'P0001';
  end if;

  select p.etapa_atual_id into v_atual from public.projetos p where p.id = v_h.projeto_id for update;
  select h.* into v_h from public.projeto_etapa_historico h where h.id = p_historico for update;
  if not found then
    raise exception 'Registro do histórico não encontrado.' using errcode = 'P0001';
  end if;

  if v_h.desfeito_em is not null then
    raise exception 'Esta mudança já foi desfeita.' using errcode = 'P0001';
  end if;
  if v_h.origem not in ('sugestao', 'automatico', 'recalculo') then
    raise exception 'Só mudanças vindas dos arquivos podem ser desfeitas.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.projeto_etapa_historico x
    where x.projeto_id = v_h.projeto_id and x.id <> v_h.id and x.desfeito_em is null and x.origem <> 'desfazer'
      and (x.em, x.id) > (v_h.em, v_h.id)
  ) then
    raise exception 'Só a última mudança do projeto pode ser desfeita.' using errcode = 'P0001';
  end if;
  if v_h.de_etapa_id is null then
    raise exception 'A etapa anterior não existe mais.' using errcode = 'P0001';
  end if;
  if v_h.para_etapa_id is distinct from v_atual then
    raise exception 'O projeto mudou de etapa depois deste registro.' using errcode = 'P0001';
  end if;

  for v_item in select e.value from jsonb_array_elements(v_h.datas_alteradas) as e loop
    update public.projeto_etapas e
       set concluida_em = (v_item ->> 'anterior')::date
     where e.id = (v_item ->> 'etapa_id')::uuid
       and e.projeto_id = v_h.projeto_id
       and e.concluida_em is not distinct from (v_item ->> 'novo')::date;
  end loop;

  perform set_config('aba.etapa_origem', 'desfazer', true);
  perform set_config('aba.etapa_sinal', coalesce(v_h.sinal_id::text, ''), true);
  perform set_config('aba.etapa_datas', '', true);
  update public.projetos set etapa_atual_id = v_h.de_etapa_id where id = v_h.projeto_id;
  perform set_config('aba.etapa_origem', '', true);
  perform set_config('aba.etapa_sinal', '', true);

  update public.projeto_etapa_historico
     set desfeito_em = now(), desfeito_por = (select auth.uid())
   where id = v_h.id;

  update public.etapa_sinais set aplicado_em = null where id = v_h.sinal_id;
end;
$$;

revoke execute on function public.desfazer_etapa(uuid) from public, anon;
grant execute on function public.desfazer_etapa(uuid) to authenticated;

-- Tudo ou nada: qualquer erro desfaz todos os projetos. Projeto da lista que não é do empreendimento é ignorado.
-- p_sinais[i] é o sinal que a pessoa viu para p_projetos[i]: só ele é aplicado. Se a sugestão mudou entre a tela e o
-- clique (chegou arquivo novo), aquele projeto fica de fora e a contagem devolvida mostra isso.
create function public.aplicar_sugestoes_empreendimento(p_empreendimento uuid, p_projetos uuid[], p_sinais uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_projeto uuid;
  v_sinal uuid;
  v_total integer := 0;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_empreendimento is null or coalesce(cardinality(p_projetos), 0) not between 1 and 500
     or cardinality(p_sinais) is distinct from cardinality(p_projetos)
     or array_position(p_projetos, null) is not null or array_position(p_sinais, null) is not null
     or (select count(distinct x) from unnest(p_projetos) x) <> cardinality(p_projetos) then
    raise exception 'A lista de projetos é inválida.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.empreendimentos e where e.id = p_empreendimento) then
    raise exception 'Empreendimento não encontrado.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.empreendimentos e where e.id = p_empreendimento and e.etapas_modo = 'desligado') then
    raise exception 'As etapas pelas pastas estão desligadas neste empreendimento.' using errcode = 'P0001';
  end if;

  for v_projeto, v_sinal in
    select p.id, l.sinal
      from unnest(p_projetos, p_sinais) as l(projeto, sinal)
      join public.projetos p on p.id = l.projeto and p.empreendimento_id = p_empreendimento
     order by p.id
  loop
    if public.etapa_aplicar_sinal_interno(v_projeto, v_sinal, 'recalculo') is not null then
      v_total := v_total + 1;
    end if;
  end loop;

  return v_total;
end;
$$;

revoke execute on function public.aplicar_sugestoes_empreendimento(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.aplicar_sugestoes_empreendimento(uuid, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. confirmar_envio_conector grava o sinal
-- ---------------------------------------------------------------------------

-- Mesma função de 20261110100000_simos_laudos.sql (assinatura, resultados e grants iguais). A mudança é depois de
-- criado o documento NOVO: se a regra tem sinal, grava em etapa_sinais e, no modo 'automatico', aplica na hora. As duas
-- coisas rodam em blocos isolados: erro aqui vira aviso no log e nunca desfaz o documento já criado.
create or replace function public.confirmar_envio_conector(
  p_envio uuid,
  p_conector uuid,
  p_titulo text,
  p_substitui uuid,
  p_agora timestamptz,
  p_equipamento text,
  p_papel text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envio public.conector_envios%rowtype;
  v_regra public.pasta_regras%rowtype;
  v_substitui uuid := p_substitui;
  v_categoria uuid := null;
  v_equipamento text := p_equipamento;
  v_papel text := p_papel;
  v_anterior_equipamento text;
  v_anterior_papel text;
  v_constraint text;
  v_sinal uuid;
  v_modo text;
begin
  select e.* into v_envio
    from public.conector_envios e
   where e.id = p_envio and e.conector_id = p_conector
   for update;

  if not found then
    return jsonb_build_object('situacao', 'nao_autorizado');
  end if;
  if v_envio.estado = 'confirmado' then
    return jsonb_build_object('situacao', 'confirmado', 'documento_id', v_envio.documento_id, 'novo', false);
  end if;
  if v_envio.estado <> 'autorizado' or v_envio.storage_path is null or v_envio.documento_planejado_id is null then
    return jsonb_build_object('situacao', 'nao_autorizado');
  end if;

  select r.* into v_regra
    from public.pasta_regras r
   where r.id = v_envio.regra_id and r.ativa;

  if not found then
    return jsonb_build_object('situacao', 'sem_regra');
  end if;

  -- Regra que marca etapa: trava o projeto ANTES de inserir documento e sinal. As FKs desses inserts seguram KEY SHARE
  -- no projeto; travar depois (no automático) faria duas confirmações do mesmo projeto se travarem uma à outra.
  if v_regra.sinal is not null and v_regra.projeto_id is not null then
    perform 1 from public.projetos p where p.id = v_regra.projeto_id for update;
  end if;

  if v_regra.tipo = 'equipamentos' then
    if coalesce(v_papel, '') not in ('simo', 'laudo') or v_equipamento is null then
      raise exception 'Regra de equipamentos exige equipamento e papel.' using errcode = '23514';
    end if;
    select c.id into v_categoria
      from public.projeto_categorias_documento c
     where c.projeto_id = v_regra.projeto_id
       and lower(btrim(c.nome)) = case v_papel when 'simo' then 'simos' else 'laudos' end
     order by c.ordem, c.id
     limit 1;
    if v_categoria is null then
      return jsonb_build_object('situacao', 'sem_categoria');
    end if;
  else
    if v_papel is not null or v_equipamento is not null then
      raise exception 'Regra comum não tem equipamento nem papel.' using errcode = '23514';
    end if;
    v_categoria := v_regra.categoria_id;
  end if;

  if v_substitui is not null then
    select d.equipamento, d.equipamento_papel
      into v_anterior_equipamento, v_anterior_papel
      from public.documentos d
     where d.id = v_substitui and d.empreendimento_id = v_envio.empreendimento_id;

    if not found then
      v_substitui := null;
    elsif v_anterior_papel is not null then
      if v_anterior_papel is distinct from v_papel then
        v_substitui := null;
      else
        v_equipamento := v_anterior_equipamento;
      end if;
    elsif v_papel is not null then
      v_substitui := null;
    end if;
  end if;

  -- Bloco com tratamento de erro = subtransação: se o índice único (empreendimento_id, sha256) confirmado
  -- acusar a corrida, o documento e a origem inseridos acima dele são desfeitos junto.
  begin
    insert into public.documentos (
      id, empreendimento_id, projeto_id, categoria_id, grupo, titulo, storage_path, mime, tamanho, sha256,
      liberado_cliente, substitui_id, equipamento, equipamento_papel
    )
    values (
      v_envio.documento_planejado_id, v_envio.empreendimento_id, v_regra.projeto_id, v_categoria,
      v_regra.grupo, p_titulo, v_envio.storage_path, 'application/pdf', v_envio.tamanho, v_envio.sha256,
      false, v_substitui, v_equipamento, v_papel
    );

    insert into public.documento_origens (
      documento_id, conector_id, regra_id, caminho_relativo, tamanho, sha256, mtime
    )
    values (
      v_envio.documento_planejado_id, p_conector, v_regra.id, v_envio.caminho_relativo, v_envio.tamanho,
      v_envio.sha256, v_envio.mtime
    );

    update public.conector_envios
       set estado = 'confirmado',
           documento_id = v_envio.documento_planejado_id,
           confirmado_em = p_agora
     where id = v_envio.id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'conector_envios_confirmado_sha256_idx' then
      return jsonb_build_object('situacao', 'duplicado');
    end if;
    raise;
  end;

  if v_regra.sinal is not null and v_regra.projeto_id is not null then
    begin
      insert into public.etapa_sinais (empreendimento_id, projeto_id, documento_id, tipo, data_arquivo)
      values (
        v_envio.empreendimento_id, v_regra.projeto_id, v_envio.documento_planejado_id, v_regra.sinal,
        coalesce(v_envio.mtime, v_envio.em)
      )
      returning id into v_sinal;
    exception when others then
      v_sinal := null;
      raise warning 'Sinal de etapa não registrado (erro %).', sqlstate;
    end;

    -- No automático aplica a sugestão ATUAL do projeto (não só a deste arquivo): se uma confirmação anterior falhou ao
    -- aplicar, esta põe a etapa em dia. O modo é conferido de novo, com trava, dentro de etapa_aplicar_sinal_interno.
    if v_sinal is not null then
      select e.etapas_modo into v_modo from public.empreendimentos e where e.id = v_envio.empreendimento_id;
      if v_modo = 'automatico' then
        begin
          select s.sinal_id into v_sinal from public.etapa_sugestao_calcular(v_regra.projeto_id) s;
          if v_sinal is not null then
            perform public.etapa_aplicar_sinal_interno(v_regra.projeto_id, v_sinal, 'automatico');
          end if;
        exception when others then
          raise warning 'Etapa automática não aplicada (erro %).', sqlstate;
        end;
      end if;
    end if;
  end if;

  return jsonb_build_object('situacao', 'confirmado', 'documento_id', v_envio.documento_planejado_id, 'novo', true);
end;
$$;

revoke execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Sinais dos envios que já chegaram
-- ---------------------------------------------------------------------------

-- Hoje só as regras 'aprovado' do preenchimento acima têm sinal. Um sinal por documento, sem duplicar.
insert into public.etapa_sinais (empreendimento_id, projeto_id, documento_id, tipo, data_arquivo)
select e.empreendimento_id, r.projeto_id, e.documento_id, r.sinal, coalesce(e.mtime, e.em)
from public.conector_envios e
join public.pasta_regras r on r.id = e.regra_id
where e.estado = 'confirmado'
  and e.documento_id is not null
  and r.sinal is not null
  and r.projeto_id is not null
on conflict (documento_id) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Regra nova de projeto numa pasta APROVADO já nasce com sinal 'aprovado'
-- ---------------------------------------------------------------------------
-- Vale só no INSERT e só quando ninguém informou o sinal: assim o "Montar a partir do servidor" (que cria as regras pela
-- função do banco) e a regra manual seguem o mesmo critério do preenchimento acima. Tirar o sinal depois é um UPDATE.
create function public.sinal_padrao_da_regra()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sinal is null
     and new.ativa
     and new.tipo = 'comum'
     and new.projeto_id is not null
     and exists (
       select 1 from unnest(string_to_array(new.caminho_prefixo, '/')) as s(segmento)
        where upper(regexp_replace(normalize(s.segmento, nfd), '[̀-ͯ]', '', 'g')) like '%APROVAD%'
     )
     and exists (select 1 from public.projeto_etapas e where e.projeto_id = new.projeto_id and e.marco = 'aprovado') then
    new.sinal := 'aprovado';
  end if;
  return new;
end;
$$;

revoke execute on function public.sinal_padrao_da_regra() from public, anon, authenticated;

create trigger pasta_regras_sinal_padrao
  before insert on public.pasta_regras
  for each row execute function public.sinal_padrao_da_regra();

-- ---------------------------------------------------------------------------
-- 10. Tela Modelos grava o marco de cada etapa
-- ---------------------------------------------------------------------------
-- Recriadas a partir de 20261106120000_etapa8_rls_andamento_obras.sql. Mudanças: a lista de etapas de MODELO aceita a
-- chave 'marco' (null, 'confeccao', 'analise' ou 'aprovado', sem repetir); salvar_modelo_portal só mexe nos marcos quando
-- algum item manda a chave (cliente antigo, sem a chave, preserva os marcos), zerando antes para permitir troca entre
-- etapas sem bater no índice único.
create or replace function public.validar_lista_portal(p_lista jsonb, p_etapas boolean, p_projeto boolean)
 returns void
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v jsonb; d date;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' then raise exception 'Lista inválida.' using errcode = '22023'; end if;
  if jsonb_array_length(p_lista) > 100 then raise exception 'Lista excede 100 itens.' using errcode = '22023'; end if;
  for v in select value from jsonb_array_elements(p_lista) loop
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'nome') is distinct from 'string'
      or length(btrim(v->>'nome')) not between 2 and 160 or jsonb_typeof(v->'ordem') is distinct from 'number'
      or (v->>'ordem') !~ '^[0-9]+$' or (v->>'ordem')::numeric > 2147483647
      or exists (select 1 from jsonb_object_keys(v) k where k not in ('id','nome','ordem','concluidaEm','marco'))
      or (v ? 'concluidaEm' and not (p_etapas and p_projeto))
      or (v ? 'marco' and not (p_etapas and not p_projeto)) then
      raise exception 'Item inválido.' using errcode = '22023';
    end if;
    if v ? 'marco' and v->'marco' <> 'null'::jsonb
       and (jsonb_typeof(v->'marco') <> 'string' or (v->>'marco') not in ('confeccao','analise','aprovado')) then
      raise exception 'Marco inválido.' using errcode = '22023';
    end if;
    if v ? 'id' then
      if jsonb_typeof(v->'id') is distinct from 'string' or (v->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ID inválido.' using errcode = '22023'; end if;
    end if;
    if v ? 'concluidaEm' and v->'concluidaEm' <> 'null'::jsonb then
      if jsonb_typeof(v->'concluidaEm') <> 'string' or (v->>'concluidaEm') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Data inválida.' using errcode = '22023'; end if;
      d := (v->>'concluidaEm')::date;
      if to_char(d, 'YYYY-MM-DD') <> v->>'concluidaEm' then raise exception 'Data inválida.' using errcode = '22023'; end if;
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_lista) v where v ? 'id' group by (v->>'id')::uuid having count(*) > 1)
    or (p_etapas and exists (select 1 from jsonb_array_elements(p_lista) v group by (v->>'ordem')::int having count(*) > 1))
    or (not p_etapas and exists (select 1 from jsonb_array_elements(p_lista) v group by btrim(v->>'nome') having count(*) > 1))
    or exists (select 1 from jsonb_array_elements(p_lista) v where v ? 'marco' and v->'marco' <> 'null'::jsonb
               group by v->>'marco' having count(*) > 1) then
    raise exception 'Lista com duplicatas.' using errcode = '22023';
  end if;
end $function$;

create or replace function public.salvar_modelo_portal(p_id uuid, p_nome text, p_descricao text, p_ativo boolean, p_etapas jsonb, p_categorias jsonb)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v_id uuid := p_id; v jsonb; v_com_marco boolean;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if p_nome is null or length(btrim(p_nome)) not between 2 and 160 or length(p_descricao) > 5000 or p_ativo is null then raise exception 'Modelo inválido.' using errcode = '22023'; end if;
  perform public.validar_lista_portal(p_etapas, true, false);
  perform public.validar_lista_portal(p_categorias, false, false);
  v_com_marco := exists (select 1 from jsonb_array_elements(p_etapas) v where v ? 'marco');
  if v_id is null then
    insert into public.modelos_etapas (nome,descricao,ativo) values (btrim(p_nome),p_descricao,p_ativo) returning id into v_id;
  else
    perform 1 from public.modelos_etapas where id = v_id for update;
    if not found then raise exception 'Modelo indisponível.' using errcode = 'P0002'; end if;
    update public.modelos_etapas set nome=btrim(p_nome),descricao=p_descricao,ativo=p_ativo where id=v_id;
  end if;
  if exists (select 1 from jsonb_array_elements(p_etapas) v where v ? 'id' and not exists (select 1 from public.modelo_etapas_itens where id=(v->>'id')::uuid and modelo_id=v_id))
    or exists (select 1 from jsonb_array_elements(p_categorias) v where v ? 'id' and not exists (select 1 from public.modelo_categorias_documento where id=(v->>'id')::uuid and modelo_id=v_id)) then
    raise exception 'ID não pertence ao modelo.' using errcode = '23514';
  end if;
  delete from public.modelo_etapas_itens where modelo_id=v_id and id not in (select (v->>'id')::uuid from jsonb_array_elements(p_etapas) v where v ? 'id');
  delete from public.modelo_categorias_documento where modelo_id=v_id and id not in (select (v->>'id')::uuid from jsonb_array_elements(p_categorias) v where v ? 'id');
  if v_com_marco then
    update public.modelo_etapas_itens set marco = null where modelo_id = v_id and marco is not null;
  end if;
  for v in select value from jsonb_array_elements(p_etapas) loop
    if v ? 'id' then
      update public.modelo_etapas_itens set nome=btrim(v->>'nome'),ordem=(v->>'ordem')::int,
             marco = case when v_com_marco then nullif(v->>'marco', '') else marco end
       where id=(v->>'id')::uuid;
    else
      insert into public.modelo_etapas_itens (modelo_id,nome,ordem,marco)
      values (v_id,btrim(v->>'nome'),(v->>'ordem')::int, case when v_com_marco then nullif(v->>'marco', '') else null end);
    end if;
  end loop;
  for v in select value from jsonb_array_elements(p_categorias) loop
    if v ? 'id' then update public.modelo_categorias_documento set nome=btrim(v->>'nome'),ordem=(v->>'ordem')::int where id=(v->>'id')::uuid;
    else insert into public.modelo_categorias_documento (modelo_id,nome,ordem) values (v_id,btrim(v->>'nome'),(v->>'ordem')::int); end if;
  end loop;
  return v_id;
end $function$;

commit;
