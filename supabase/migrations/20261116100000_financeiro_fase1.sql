-- Financeiro automático, fase 1 (docs/FINANCEIRO-FASE1-CONTRATO.md, aprovado em 15/11/2026).
-- 1. itens_financeiros: o contrato da ABA é o item SEM fornecedor. Colunas codigo, versao, assinado_em e documento_id;
--    trigger que exige código no contrato e confere o PDF (mesmo empreendimento, application/pdf, nunca ORÇAMENTO).
-- 2. item_financeiro_projetos: projetos que o contrato cobre.
-- 3. financeiro_eventos: um registro por acontecimento (assinatura, protocolo, aprovação, entrega, doações, TRO,
--    urbanístico, outro), com origem e desfazer. Sem escrita direta: só as funções abaixo gravam.
-- 4. parcelas: vencimento aceita nulo; gatilho (data | evento), evento_*, dias_apos, evento_id e numero. Um trigger recusa
--    mexer nos campos do gatilho e no vencimento de parcela por evento fora das funções definer (modo interno): o editor
--    antigo continua registrando pagamento e editando parcela de data fixa.
-- 5. financeiro_recalcular_vencimentos (interna): vencimento = data do evento ativo + dias_apos, ou nulo sem evento.
-- 6. Eventos das etapas: constraint trigger adiado em projeto_etapa_historico (a inserção cria protocolo, entrega e
--    aprovação; as datas da etapa já foram salvas quando ele roda) e trigger do desfazer.
-- 7. marcar_evento_financeiro / desfazer_evento_financeiro (botões do admin).
-- 8. salvar_contrato_portal: contrato + projetos + parcelas numa chamada só, atômica, com conferência de edição concorrente.
-- 9. listar_a_cobrar (invoker, o RLS vale).
-- 10. Eventos dos projetos que já passaram das etapas de análise e aprovado (financeiro_eventos_retroativos).
-- Nenhuma política existente muda. Desfazer: supabase/reversoes/20261116100000_financeiro_fase1.down.sql.
begin;

-- ---------------------------------------------------------------------------
-- Ajudantes internos (sem grant para ninguém)
-- ---------------------------------------------------------------------------

-- Minúsculas e sem acento: "Orçamento" e "ORCAMENTO" viram "orcamento".
create function public.financeiro_texto_simples(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(normalize(p_texto, nfd), '[̀-ͯ]', '', 'g'))
$$;

-- Texto de um valor jsonb que seja string; qualquer outro tipo (ou ausente) vira nulo.
create function public.financeiro_json_texto(p_valor jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_valor) = 'string' then p_valor #>> '{}' end
$$;

-- Ausente ou null no JSON.
create function public.financeiro_json_vazio(p_valor jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_valor is null or jsonb_typeof(p_valor) = 'null'
$$;

-- AAAA-MM-DD válido, senão nulo (o cast direto devolveria uma mensagem técnica do Postgres).
create function public.financeiro_ler_data(p_texto text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_texto is null or p_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return p_texto::date;
exception when others then
  return null;
end;
$$;

create function public.financeiro_ler_uuid(p_texto text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_texto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_texto::uuid
  end
$$;

revoke execute on function public.financeiro_texto_simples(text) from public, anon, authenticated, service_role;
revoke execute on function public.financeiro_json_texto(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.financeiro_json_vazio(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.financeiro_ler_data(text) from public, anon, authenticated, service_role;
revoke execute on function public.financeiro_ler_uuid(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. itens_financeiros: o contrato da ABA
-- ---------------------------------------------------------------------------

-- [0-9] em vez de \d: o código vira nome de pasta e não pode aceitar dígito de outro alfabeto.
alter table public.itens_financeiros
  add column codigo text,
  add column versao integer,
  add column assinado_em date,
  add column documento_id uuid references public.documentos (id) on delete set null,
  add constraint itens_financeiros_codigo_check check (codigo ~ '^[0-9]{6}[A-Z]{1,4}$'),
  add constraint itens_financeiros_versao_check check (versao >= 1),
  add constraint itens_financeiros_fornecedor_sem_contrato_check check (
    fornecedor_id is null
    or (codigo is null and versao is null and assinado_em is null and documento_id is null)
  );

create index itens_financeiros_documento_id_idx on public.itens_financeiros (documento_id);
create unique index itens_financeiros_codigo_idx on public.itens_financeiros (codigo) where codigo is not null;

-- Definer: quem salva o contrato pode não ler documentos, e o trigger precisa enxergá-los. A mensagem de "não existe"
-- vale também para documento de outro empreendimento, para não confirmar que o id existe em outro lugar.
-- A conferência só roda quando o documento (ou o empreendimento) muda: o "on delete set null" do documento passa direto.
create function public.validar_item_financeiro_contrato()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_documento public.documentos%rowtype;
begin
  -- O código obrigatório fica em salvar_contrato_portal (o caminho da tela): aqui ele recusaria antes do RLS e trocaria
  -- o "acesso negado" de quem não pode escrever por uma mensagem de validação.
  -- Código, versão, assinatura e PDF só mudam pela função (a assinatura gera evento e vencimentos). Exceção: o
  -- "on delete set null" do documento, que chega por trigger de chave estrangeira (pg_trigger_depth > 1).
  if coalesce(current_setting('aba.financeiro_interno', true), '') <> '1' then
    if tg_op = 'INSERT' then
      if new.codigo is not null or new.versao is not null or new.assinado_em is not null or new.documento_id is not null then
        raise exception 'Contrato da ABA só pode ser criado pela tela de contrato.' using errcode = 'P0001';
      end if;
    elsif (new.codigo, new.versao, new.assinado_em) is distinct from (old.codigo, old.versao, old.assinado_em)
          or (new.documento_id is distinct from old.documento_id
              and not (new.documento_id is null and pg_trigger_depth() > 1)) then
      raise exception 'Código, versão, assinatura e PDF do contrato só mudam pela tela de contrato.' using errcode = 'P0001';
    end if;
  end if;

  if new.documento_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.documento_id is not distinct from old.documento_id
     and new.empreendimento_id is not distinct from old.empreendimento_id then
    return new;
  end if;

  select d.* into v_documento
    from public.documentos d
   where d.id = new.documento_id and d.empreendimento_id = new.empreendimento_id;
  if not found then
    raise exception 'O documento do contrato não existe neste empreendimento.' using errcode = '23514';
  end if;
  if v_documento.mime is distinct from 'application/pdf' then
    raise exception 'O documento do contrato precisa ser um PDF.' using errcode = '23514';
  end if;
  -- Só o CONTRATO assinado gera financeiro: orçamento (no título, no caminho ou na pasta de orçamentos) é recusado.
  if public.financeiro_texto_simples(v_documento.titulo) like '%orcamento%'
     or public.financeiro_texto_simples(v_documento.storage_path) like '%orcamento%'
     or v_documento.grupo = 'orcamentos' then
    raise exception 'Este documento é um orçamento. Só o contrato assinado gera financeiro.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_item_financeiro_contrato() from public, anon, authenticated, service_role;

create trigger itens_financeiros_validar_contrato
  before insert or update on public.itens_financeiros
  for each row execute function public.validar_item_financeiro_contrato();

-- ---------------------------------------------------------------------------
-- 2. item_financeiro_projetos
-- ---------------------------------------------------------------------------

create table public.item_financeiro_projetos (
  item_id uuid not null references public.itens_financeiros (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  primary key (item_id, projeto_id)
);

create index item_financeiro_projetos_projeto_id_idx on public.item_financeiro_projetos (projeto_id);

create function public.validar_item_financeiro_projeto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.itens_financeiros i
      join public.projetos p on p.empreendimento_id = i.empreendimento_id
     where i.id = new.item_id and i.fornecedor_id is null and p.id = new.projeto_id
  ) then
    raise exception 'O projeto precisa ser do mesmo empreendimento de um contrato da ABA.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.validar_item_financeiro_projeto() from public, anon, authenticated, service_role;

create trigger item_financeiro_projetos_validar
  before insert or update on public.item_financeiro_projetos
  for each row execute function public.validar_item_financeiro_projeto();

alter table public.item_financeiro_projetos enable row level security;

revoke all on table public.item_financeiro_projetos from anon;
revoke all on table public.item_financeiro_projetos from authenticated;
grant select on table public.item_financeiro_projetos to authenticated;

-- A leitura herda a de itens_financeiros (o subselect passa pelo RLS do item), como as parcelas.
create policy "quem lê o item financeiro lê os projetos do contrato"
  on public.item_financeiro_projetos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.itens_financeiros i
      where i.id = item_financeiro_projetos.item_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. financeiro_eventos
-- ---------------------------------------------------------------------------

create table public.financeiro_eventos (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  tipo text not null check (tipo in (
    'assinatura', 'protocolo', 'aprovacao', 'entrega', 'doacoes_protocolo', 'doacoes_liberacao',
    'tro_pedido', 'tro_liberacao', 'urbanistico_aprovacao', 'outro'
  )),
  projeto_id uuid references public.projetos (id) on delete cascade,
  item_id uuid references public.itens_financeiros (id) on delete cascade,
  parcela_id uuid references public.parcelas (id) on delete cascade,
  ocorrido_em date not null,
  origem text not null check (origem in ('etapas', 'botao', 'contrato', 'protocolo')),
  historico_id uuid references public.projeto_etapa_historico (id) on delete set null,
  -- Entrega derivada de um protocolo marcado pelo botão: desfazer ou substituir o protocolo leva a entrega junto.
  origem_evento_id uuid references public.financeiro_eventos (id) on delete cascade,
  criado_por uuid references public.profiles (id) on delete set null default auth.uid(),
  -- clock_timestamp (e não now): dois eventos na mesma transação continuam em ordem.
  criado_em timestamptz not null default clock_timestamp(),
  desfeito_em timestamptz,
  desfeito_por uuid references public.profiles (id) on delete set null,
  constraint financeiro_eventos_alvo_check check (
    (tipo = 'assinatura' and item_id is not null and projeto_id is null and parcela_id is null)
    or (tipo in ('protocolo', 'aprovacao') and projeto_id is not null and item_id is null and parcela_id is null)
    or (tipo = 'entrega' and parcela_id is null and ((projeto_id is null) <> (item_id is null)))
    or (tipo in ('doacoes_protocolo', 'doacoes_liberacao', 'tro_pedido', 'tro_liberacao', 'urbanistico_aprovacao')
        and projeto_id is null and item_id is null and parcela_id is null)
    or (tipo = 'outro' and parcela_id is not null and projeto_id is null and item_id is null)
  ),
  constraint financeiro_eventos_origem_tipo_check check ((tipo = 'assinatura') = (origem = 'contrato'))
);

create index financeiro_eventos_empreendimento_idx on public.financeiro_eventos (empreendimento_id);
create index financeiro_eventos_projeto_idx on public.financeiro_eventos (projeto_id);
create index financeiro_eventos_item_idx on public.financeiro_eventos (item_id);
create index financeiro_eventos_parcela_idx on public.financeiro_eventos (parcela_id);
create index financeiro_eventos_historico_idx on public.financeiro_eventos (historico_id);
create index financeiro_eventos_origem_evento_idx on public.financeiro_eventos (origem_evento_id);
create index financeiro_eventos_criado_por_idx on public.financeiro_eventos (criado_por);
create index financeiro_eventos_desfeito_por_idx on public.financeiro_eventos (desfeito_por);

-- Um evento ativo por empreendimento, tipo e alvo. O alvo é um só (o check acima), então o coalesce é inequívoco;
-- os eventos do empreendimento (doações, TRO, urbanístico) não têm alvo e caem no uuid zero.
create unique index financeiro_eventos_ativo_idx on public.financeiro_eventos (
  empreendimento_id, tipo, coalesce(projeto_id, item_id, parcela_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where desfeito_em is null;

alter table public.financeiro_eventos enable row level security;

revoke all on table public.financeiro_eventos from anon;
revoke all on table public.financeiro_eventos from authenticated;
grant select on table public.financeiro_eventos to authenticated;

create policy "financeiro.ver lê eventos do financeiro"
  on public.financeiro_eventos
  for select
  to authenticated
  using ((select public.tem_permissao('financeiro.ver')));

-- ---------------------------------------------------------------------------
-- 4. parcelas: gatilho
-- ---------------------------------------------------------------------------

alter table public.parcelas
  alter column vencimento drop not null,
  add column numero integer,
  add column gatilho text not null default 'data',
  add column evento_tipo text,
  add column evento_projeto_id uuid references public.projetos (id) on delete restrict,
  add column evento_descricao text,
  add column dias_apos integer not null default 0,
  add column evento_id uuid references public.financeiro_eventos (id) on delete set null,
  add constraint parcelas_numero_check check (numero >= 1),
  add constraint parcelas_gatilho_check check (gatilho in ('data', 'evento')),
  add constraint parcelas_evento_tipo_check check (evento_tipo in (
    'assinatura', 'protocolo', 'aprovacao', 'entrega', 'doacoes_protocolo', 'doacoes_liberacao',
    'tro_pedido', 'tro_liberacao', 'urbanistico_aprovacao', 'outro'
  )),
  add constraint parcelas_evento_descricao_check check (char_length(btrim(evento_descricao)) between 1 and 120),
  add constraint parcelas_dias_apos_check check (dias_apos between 0 and 3650),
  add constraint parcelas_gatilho_data_check check (
    gatilho <> 'data'
    or (vencimento is not null and evento_tipo is null and evento_projeto_id is null
        and evento_descricao is null and evento_id is null and dias_apos = 0)
  ),
  add constraint parcelas_gatilho_evento_check check (
    gatilho <> 'evento'
    or (evento_tipo is not null
        and (evento_tipo not in ('protocolo', 'aprovacao') or evento_projeto_id is not null)
        and (evento_tipo <> 'outro' or evento_descricao is not null))
  ),
  add constraint parcelas_evento_descricao_so_outro_check check (evento_descricao is null or evento_tipo = 'outro'),
  add constraint parcelas_evento_projeto_tipo_check check (
    evento_projeto_id is null or evento_tipo in ('protocolo', 'aprovacao', 'entrega')
  ),
  -- Só confere no commit: a função de salvar renumera as parcelas do contrato dentro da transação.
  add constraint parcelas_item_numero_key unique (item_id, numero) deferrable initially deferred;

create index parcelas_evento_projeto_id_idx on public.parcelas (evento_projeto_id);
create index parcelas_evento_id_idx on public.parcelas (evento_id);

-- Fora do modo interno (aba.financeiro_interno = '1', ligado e desligado só pelas funções definer abaixo com set_config
-- local), ninguém cria parcela por evento nem muda o gatilho, o evento, os dias, o número ou o vencimento de uma parcela
-- por evento. Pagamento, nome, valor e vencimento de parcela de data fixa continuam livres (editor antigo).
-- Exceção estreita: evento_id passando de preenchido a nulo sem mais nenhuma mudança. É o "on delete set null" do
-- evento, que dispara este trigger como um UPDATE comum (apagar um contrato apaga os eventos e as parcelas na mesma
-- cascata); recusar aqui impediria excluir o contrato.
create function public.proteger_parcela_evento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('aba.financeiro_interno', true), '') = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.gatilho = 'evento' then
      raise exception 'Parcela por evento só pode ser criada ao salvar o contrato.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.evento_id is null and old.evento_id is not null and pg_trigger_depth() > 1
     and new.item_id is not distinct from old.item_id
     and (new.gatilho, new.evento_tipo, new.evento_projeto_id, new.evento_descricao, new.dias_apos, new.numero, new.vencimento)
         is not distinct from
         (old.gatilho, old.evento_tipo, old.evento_projeto_id, old.evento_descricao, old.dias_apos, old.numero, old.vencimento) then
    return new;
  end if;

  if (new.item_id, new.gatilho, new.evento_tipo, new.evento_projeto_id, new.evento_descricao, new.dias_apos, new.evento_id, new.numero)
     is distinct from
     (old.item_id, old.gatilho, old.evento_tipo, old.evento_projeto_id, old.evento_descricao, old.dias_apos, old.evento_id, old.numero) then
    raise exception 'O evento desta parcela só muda ao salvar o contrato.' using errcode = 'P0001';
  end if;
  if old.gatilho = 'evento' and new.vencimento is distinct from old.vencimento then
    raise exception 'O vencimento desta parcela é calculado pelo evento. Marque o evento ou mude a regra no contrato.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.proteger_parcela_evento() from public, anon, authenticated, service_role;

create trigger parcelas_proteger_evento
  before insert or update on public.parcelas
  for each row execute function public.proteger_parcela_evento();

-- ---------------------------------------------------------------------------
-- 5. Recalcular vencimentos
-- ---------------------------------------------------------------------------

-- Idempotente: o resultado depende só dos eventos ativos. Sem grant para ninguém; quem chama já conferiu a permissão (ou
-- é um trigger). O advisory lock serializa os recálculos do mesmo empreendimento; sendo da transação, quem já o tem
-- (as funções de salvar e marcar) o pega de novo sem esperar. A bandeira do modo interno volta ao valor anterior porque
-- o chamador pode estar no meio das próprias escritas.
create function public.financeiro_recalcular_vencimentos(p_empreendimento uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text := current_setting('aba.financeiro_interno', true);
begin
  perform pg_advisory_xact_lock(hashtextextended('financeiro:' || p_empreendimento::text, 0));
  perform set_config('aba.financeiro_interno', '1', true);

  update public.parcelas p
     set evento_id = c.evento_id,
         vencimento = c.vencimento
    from (
      select pe.id as parcela_id, ev.id as evento_id, ev.ocorrido_em + pe.dias_apos as vencimento
        from public.parcelas pe
        join public.itens_financeiros i on i.id = pe.item_id
        left join lateral (
          select e.id, e.ocorrido_em
            from public.financeiro_eventos e
           where e.empreendimento_id = p_empreendimento
             and e.desfeito_em is null
             and e.tipo = pe.evento_tipo
             and case pe.evento_tipo
                   when 'assinatura' then e.item_id = pe.item_id
                   when 'protocolo' then e.projeto_id = pe.evento_projeto_id
                   when 'aprovacao' then e.projeto_id = pe.evento_projeto_id
                   when 'entrega' then
                     case when pe.evento_projeto_id is not null
                          then e.projeto_id = pe.evento_projeto_id
                          else e.item_id = pe.item_id
                     end
                   when 'outro' then e.parcela_id = pe.id
                   else true
                 end
           order by e.ocorrido_em, e.id
           limit 1
        ) ev on true
       where i.empreendimento_id = p_empreendimento
         and pe.gatilho = 'evento'
    ) c
   where p.id = c.parcela_id
     and (p.evento_id is distinct from c.evento_id or p.vencimento is distinct from c.vencimento);

  perform set_config('aba.financeiro_interno', coalesce(v_antes, ''), true);
end;
$$;

revoke execute on function public.financeiro_recalcular_vencimentos(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Eventos das etapas
-- ---------------------------------------------------------------------------

-- Constraint trigger adiado: roda no commit, depois que a transação que mudou a etapa já salvou as datas
-- (concluida_em) das etapas. O histórico é relido porque a linha pode já ter sido desfeita na mesma transação.
-- "Primeiro vale": o índice único dos eventos ativos faz uma volta da Copasa (LAN -> Em confecção -> novo protocolo)
-- não mudar a data já registrada; o on conflict do nothing também protege de duas transações no mesmo projeto.
create function public.financeiro_eventos_do_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_historico public.projeto_etapa_historico%rowtype;
  v_empreendimento uuid;
  v_ordem_analise integer;
  v_ordem_aprovado integer;
  v_ordem_para integer;
  v_dia_sinal date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_data date;
  v_linhas integer;
  v_novos integer := 0;
begin
  select h.* into v_historico from public.projeto_etapa_historico h where h.id = new.id;
  if not found or v_historico.origem = 'desfazer' or v_historico.desfeito_em is not null then
    return null;
  end if;

  select p.empreendimento_id into v_empreendimento from public.projetos p where p.id = v_historico.projeto_id;
  if not found then
    return null;
  end if;

  select e.ordem into v_ordem_para from public.projeto_etapas e where e.id = v_historico.para_etapa_id;
  if v_ordem_para is null then
    return null;
  end if;
  select e.ordem into v_ordem_analise
    from public.projeto_etapas e where e.projeto_id = v_historico.projeto_id and e.marco = 'analise';
  select e.ordem into v_ordem_aprovado
    from public.projeto_etapas e where e.projeto_id = v_historico.projeto_id and e.marco = 'aprovado';

  select (s.data_arquivo at time zone 'America/Sao_Paulo')::date into v_dia_sinal
    from public.etapa_sinais s where s.id = v_historico.sinal_id;

  if (v_ordem_analise is not null and v_ordem_para >= v_ordem_analise)
     or (v_ordem_aprovado is not null and v_ordem_para >= v_ordem_aprovado) then
    perform pg_advisory_xact_lock(hashtextextended('financeiro:' || v_empreendimento::text, 0));
  end if;

  if v_ordem_analise is not null and v_ordem_para >= v_ordem_analise then
    v_data := coalesce(
      v_dia_sinal,
      (select e.concluida_em from public.projeto_etapas e
        where e.projeto_id = v_historico.projeto_id and e.ordem < v_ordem_analise
        order by e.ordem desc limit 1),
      v_hoje
    );

    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, historico_id, criado_por)
    values (v_empreendimento, 'protocolo', v_historico.projeto_id, v_data, 'etapas', v_historico.id, v_historico.por)
    on conflict do nothing;
    get diagnostics v_linhas = row_count;
    v_novos := v_novos + v_linhas;

    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, historico_id, criado_por)
    values (v_empreendimento, 'entrega', v_historico.projeto_id, v_data, 'protocolo', v_historico.id, v_historico.por)
    on conflict do nothing;
    get diagnostics v_linhas = row_count;
    v_novos := v_novos + v_linhas;
  end if;

  if v_ordem_aprovado is not null and v_ordem_para >= v_ordem_aprovado then
    v_data := coalesce(
      v_dia_sinal,
      (select e.concluida_em from public.projeto_etapas e
        where e.projeto_id = v_historico.projeto_id and e.ordem = v_ordem_aprovado),
      v_hoje
    );

    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, historico_id, criado_por)
    values (v_empreendimento, 'aprovacao', v_historico.projeto_id, v_data, 'etapas', v_historico.id, v_historico.por)
    on conflict do nothing;
    get diagnostics v_linhas = row_count;
    v_novos := v_novos + v_linhas;
  end if;

  if v_novos > 0 then
    perform public.financeiro_recalcular_vencimentos(v_empreendimento);
  end if;

  return null;
end;
$$;

revoke execute on function public.financeiro_eventos_do_historico() from public, anon, authenticated, service_role;

create constraint trigger projeto_etapa_historico_eventos_financeiros
  after insert on public.projeto_etapa_historico
  deferrable initially deferred
  for each row execute function public.financeiro_eventos_do_historico();

-- Desfazer a mudança de etapa (desfazer_etapa preenche desfeito_em) desfaz os eventos que ela criou, inclusive a entrega
-- de origem protocolo, e as parcelas voltam a aguardar.
create function public.financeiro_desfazer_eventos_do_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empreendimento uuid;
begin
  select distinct e.empreendimento_id into v_empreendimento
    from public.financeiro_eventos e
   where e.historico_id = new.id and e.desfeito_em is null;
  if not found then
    return null;
  end if;

  -- Mesma ordem de travas das funções de marcar e salvar: advisory do empreendimento antes das linhas de evento.
  perform pg_advisory_xact_lock(hashtextextended('financeiro:' || v_empreendimento::text, 0));

  update public.financeiro_eventos e
     set desfeito_em = new.desfeito_em, desfeito_por = new.desfeito_por
   where e.historico_id = new.id and e.desfeito_em is null;

  perform public.financeiro_recalcular_vencimentos(v_empreendimento);
  return null;
end;
$$;

revoke execute on function public.financeiro_desfazer_eventos_do_historico() from public, anon, authenticated, service_role;

create trigger projeto_etapa_historico_desfazer_eventos_financeiros
  after update of desfeito_em on public.projeto_etapa_historico
  for each row
  when (old.desfeito_em is null and new.desfeito_em is not null)
  execute function public.financeiro_desfazer_eventos_do_historico();

-- ---------------------------------------------------------------------------
-- 7. Botões: marcar e desfazer evento
-- ---------------------------------------------------------------------------

-- Alvo de cada tipo: protocolo e aprovação = projeto; entrega = projeto OU contrato; doações, TRO e urbanístico =
-- nenhum (valem para o empreendimento); outro = a parcela. A assinatura não passa por aqui: vem da data do contrato.
create function public.marcar_evento_financeiro(
  p_empreendimento uuid,
  p_tipo text,
  p_data date,
  p_projeto uuid default null,
  p_item uuid default null,
  p_parcela uuid default null,
  p_substituir boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_alvo_ok boolean;
  v_ativo public.financeiro_eventos%rowtype;
  v_id uuid;
begin
  if not (select public.tem_permissao('financeiro.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_empreendimento is null or p_tipo is null or p_data is null or p_substituir is null then
    raise exception 'Informe o empreendimento, o evento e a data.' using errcode = '22023';
  end if;
  if p_tipo = 'assinatura' then
    raise exception 'A assinatura vem da data do contrato. Mude a data no contrato.' using errcode = 'P0001';
  end if;
  if p_tipo not in ('protocolo', 'aprovacao', 'entrega', 'doacoes_protocolo', 'doacoes_liberacao', 'tro_pedido',
                    'tro_liberacao', 'urbanistico_aprovacao', 'outro') then
    raise exception 'Evento desconhecido.' using errcode = '22023';
  end if;

  v_alvo_ok := case
    when p_tipo in ('protocolo', 'aprovacao') then p_projeto is not null and p_item is null and p_parcela is null
    when p_tipo = 'entrega' then (p_projeto is null) <> (p_item is null) and p_parcela is null
    when p_tipo = 'outro' then p_parcela is not null and p_projeto is null and p_item is null
    else p_projeto is null and p_item is null and p_parcela is null
  end;
  if not v_alvo_ok then
    raise exception 'O alvo informado não serve para este evento.' using errcode = '22023';
  end if;
  if p_data < date '2000-01-01' or p_data > v_hoje then
    raise exception 'A data precisa estar entre 01/01/2000 e hoje.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.empreendimentos e where e.id = p_empreendimento) then
    raise exception 'Empreendimento não encontrado.' using errcode = 'P0001';
  end if;
  if p_projeto is not null and not exists (
    select 1 from public.projetos pr where pr.id = p_projeto and pr.empreendimento_id = p_empreendimento
  ) then
    raise exception 'Projeto não encontrado neste empreendimento.' using errcode = 'P0001';
  end if;
  if p_item is not null and not exists (
    select 1 from public.itens_financeiros i
     where i.id = p_item and i.empreendimento_id = p_empreendimento and i.fornecedor_id is null
  ) then
    raise exception 'Contrato não encontrado neste empreendimento.' using errcode = 'P0001';
  end if;
  if p_parcela is not null and not exists (
    select 1
      from public.parcelas pa
      join public.itens_financeiros i on i.id = pa.item_id
     where pa.id = p_parcela and i.empreendimento_id = p_empreendimento and i.fornecedor_id is null
       and pa.gatilho = 'evento' and pa.evento_tipo = 'outro'
  ) then
    raise exception 'Parcela não encontrada neste empreendimento, ou ela não aguarda um evento "outro".'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('financeiro:' || p_empreendimento::text, 0));

  select e.* into v_ativo
    from public.financeiro_eventos e
   where e.empreendimento_id = p_empreendimento and e.tipo = p_tipo and e.desfeito_em is null
     and e.projeto_id is not distinct from p_projeto
     and e.item_id is not distinct from p_item
     and e.parcela_id is not distinct from p_parcela
     for update;
  if found then
    if not p_substituir then
      raise exception 'Já marcado em %', to_char(v_ativo.ocorrido_em, 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    update public.financeiro_eventos
       set desfeito_em = clock_timestamp(), desfeito_por = (select auth.uid())
     where (id = v_ativo.id or origem_evento_id = v_ativo.id) and desfeito_em is null;
  end if;

  insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, item_id, parcela_id, ocorrido_em, origem, criado_por)
  values (p_empreendimento, p_tipo, p_projeto, p_item, p_parcela, p_data, 'botao', (select auth.uid()))
  returning id into v_id;

  -- Entrega = botão ou primeiro protocolo, o que vier primeiro: uma entrega já ativa do projeto continua valendo.
  if p_tipo = 'protocolo' then
    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, origem_evento_id, criado_por)
    values (p_empreendimento, 'entrega', p_projeto, p_data, 'protocolo', v_id, (select auth.uid()))
    on conflict do nothing;
  end if;

  perform public.financeiro_recalcular_vencimentos(p_empreendimento);
  return v_id;
end;
$$;

revoke execute on function public.marcar_evento_financeiro(uuid, text, date, uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.marcar_evento_financeiro(uuid, text, date, uuid, uuid, uuid, boolean) to authenticated;

create function public.desfazer_evento_financeiro(p_evento uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento public.financeiro_eventos%rowtype;
begin
  if not (select public.tem_permissao('financeiro.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select e.* into v_evento from public.financeiro_eventos e where e.id = p_evento;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('financeiro:' || v_evento.empreendimento_id::text, 0));

  select e.* into v_evento from public.financeiro_eventos e where e.id = p_evento for update;
  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0001';
  end if;
  if v_evento.tipo = 'assinatura' then
    raise exception 'A assinatura vem da data do contrato. Mude a data no contrato.' using errcode = 'P0001';
  end if;
  if v_evento.desfeito_em is not null then
    raise exception 'Este evento já foi desfeito.' using errcode = 'P0001';
  end if;

  update public.financeiro_eventos
     set desfeito_em = clock_timestamp(), desfeito_por = (select auth.uid())
   where (id = v_evento.id or origem_evento_id = v_evento.id) and desfeito_em is null;

  perform public.financeiro_recalcular_vencimentos(v_evento.empreendimento_id);
end;
$$;

revoke execute on function public.desfazer_evento_financeiro(uuid) from public, anon;
grant execute on function public.desfazer_evento_financeiro(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Salvar o contrato inteiro
-- ---------------------------------------------------------------------------

-- p_dados: descricao, codigo, versao, assinado_em, documento_id, valor_contratado_centavos (texto de dígitos),
-- observacao, projetos (uuids) e parcelas (até 60, na ordem da tela: o número da parcela é a posição). Criar = p_id nulo.
-- Edição: o item é trancado, tem de ser do empreendimento, sem fornecedor, e p_atualizado_em tem de ser o atualizado_em
-- lido pela tela (comparado em milissegundos: o JavaScript não guarda os microssegundos do Postgres).
-- O pagamento nunca é lido nem gravado aqui. Erro de formato: 22023; regra de negócio: P0001.
create function public.salvar_contrato_portal(
  p_id uuid,
  p_empreendimento uuid,
  p_dados jsonb,
  p_atualizado_em timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_item uuid;
  v_item_atual public.itens_financeiros%rowtype;
  v_descricao text;
  v_codigo text;
  v_versao integer;
  v_assinado date;
  v_documento uuid;
  v_valor bigint;
  v_observacao text;
  v_texto text;
  v_projetos uuid[];
  v_parcelas jsonb;
  v_parcela jsonb;
  v_ids uuid[] := '{}';
  v_id_lido uuid;
  v_posicao integer := 0;
  v_nome text;
  v_valor_parcela bigint;
  v_gatilho text;
  v_vencimento date;
  v_tipo text;
  v_projeto uuid;
  v_descricao_evento text;
  v_dias integer;
  v_parcela_id uuid;
  v_mantem boolean;
  v_evento public.financeiro_eventos%rowtype;
  v_tem_assinatura boolean;
  v_bandeira_antes text;
begin
  if not (select public.tem_permissao('financeiro.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_empreendimento is null or not exists (select 1 from public.empreendimentos e where e.id = p_empreendimento) then
    raise exception 'Empreendimento não encontrado.' using errcode = 'P0001';
  end if;

  -- Formato dos dados do contrato.
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Os dados do contrato são inválidos.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_dados) k
     where k not in ('descricao', 'codigo', 'versao', 'assinado_em', 'documento_id', 'valor_contratado_centavos',
                     'observacao', 'projetos', 'parcelas')
  ) then
    raise exception 'Os dados do contrato têm um campo desconhecido.' using errcode = '22023';
  end if;

  v_descricao := btrim(public.financeiro_json_texto(p_dados -> 'descricao'));
  if v_descricao is null or char_length(v_descricao) not between 1 and 200 then
    raise exception 'Informe a descrição do contrato (até 200 caracteres).' using errcode = '22023';
  end if;

  v_codigo := upper(btrim(public.financeiro_json_texto(p_dados -> 'codigo')));
  if v_codigo is null or v_codigo !~ '^[0-9]{6}[A-Z]{1,4}$' then
    raise exception 'Informe o código do contrato no formato 260703C.' using errcode = '22023';
  end if;

  if not public.financeiro_json_vazio(p_dados -> 'versao') then
    v_texto := case when jsonb_typeof(p_dados -> 'versao') = 'number' then p_dados ->> 'versao' end;
    if v_texto is null or v_texto !~ '^[0-9]{1,6}$' then
      raise exception 'A versão do contrato é inválida.' using errcode = '22023';
    end if;
    v_versao := v_texto::integer;
    if v_versao < 1 then
      raise exception 'A versão do contrato é inválida.' using errcode = '22023';
    end if;
  end if;

  if not public.financeiro_json_vazio(p_dados -> 'assinado_em') then
    v_assinado := public.financeiro_ler_data(public.financeiro_json_texto(p_dados -> 'assinado_em'));
    if v_assinado is null or v_assinado < date '2000-01-01' or v_assinado > v_hoje then
      raise exception 'A data de assinatura precisa estar entre 01/01/2000 e hoje.' using errcode = '22023';
    end if;
  end if;

  if not public.financeiro_json_vazio(p_dados -> 'documento_id') then
    v_documento := public.financeiro_ler_uuid(public.financeiro_json_texto(p_dados -> 'documento_id'));
    if v_documento is null then
      raise exception 'O documento do contrato é inválido.' using errcode = '22023';
    end if;
  end if;

  v_texto := public.financeiro_json_texto(p_dados -> 'valor_contratado_centavos');
  if v_texto is null or v_texto !~ '^[0-9]{1,15}$' then
    raise exception 'O valor contratado é inválido.' using errcode = '22023';
  end if;
  v_valor := v_texto::bigint;

  if not public.financeiro_json_vazio(p_dados -> 'observacao') then
    v_observacao := public.financeiro_json_texto(p_dados -> 'observacao');
    if v_observacao is null or char_length(v_observacao) > 5000 then
      raise exception 'A observação é inválida (até 5000 caracteres).' using errcode = '22023';
    end if;
    v_observacao := nullif(btrim(v_observacao), '');
  end if;

  -- O tamanho só é lido depois de confirmar que é array (o Postgres não garante a ordem de avaliação de um "or").
  if jsonb_typeof(p_dados -> 'projetos') is distinct from 'array' then
    raise exception 'A lista de projetos do contrato é inválida.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_dados -> 'projetos') > 100 then
    raise exception 'A lista de projetos do contrato é inválida.' using errcode = '22023';
  end if;
  select coalesce(array_agg(public.financeiro_ler_uuid(public.financeiro_json_texto(x.valor)) order by x.ordem), '{}')
    into v_projetos
    from jsonb_array_elements(p_dados -> 'projetos') with ordinality as x(valor, ordem);
  if array_position(v_projetos, null) is not null
     or (select count(distinct u) from unnest(v_projetos) as u) <> cardinality(v_projetos) then
    raise exception 'A lista de projetos do contrato é inválida.' using errcode = '22023';
  end if;

  v_parcelas := p_dados -> 'parcelas';
  if jsonb_typeof(v_parcelas) is distinct from 'array' then
    raise exception 'A lista de parcelas é inválida (até 60 parcelas).' using errcode = '22023';
  end if;
  if jsonb_array_length(v_parcelas) > 60 then
    raise exception 'A lista de parcelas é inválida (até 60 parcelas).' using errcode = '22023';
  end if;

  if (select count(*) from public.projetos pr
       where pr.id = any (v_projetos) and pr.empreendimento_id = p_empreendimento) <> cardinality(v_projetos) then
    raise exception 'Algum projeto não pertence a este empreendimento.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('financeiro:' || p_empreendimento::text, 0));

  -- Modo interno desde já: os campos do contrato e o gatilho das parcelas só mudam por aqui.
  v_bandeira_antes := current_setting('aba.financeiro_interno', true);
  perform set_config('aba.financeiro_interno', '1', true);

  -- O contrato: criar ou editar.
  if p_id is null then
    if exists (select 1 from public.itens_financeiros i where i.codigo = v_codigo) then
      raise exception 'Já existe um contrato com este código.' using errcode = 'P0001';
    end if;

    insert into public.itens_financeiros (
      empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos, observacao,
      codigo, versao, assinado_em, documento_id
    )
    values (p_empreendimento, null, v_descricao, v_valor, v_observacao, v_codigo, v_versao, v_assinado, v_documento)
    returning id into v_item;
  else
    select i.* into v_item_atual from public.itens_financeiros i where i.id = p_id for update;
    if not found or v_item_atual.empreendimento_id <> p_empreendimento then
      raise exception 'Contrato não encontrado neste empreendimento.' using errcode = 'P0001';
    end if;
    if v_item_atual.fornecedor_id is not null then
      raise exception 'Este item é de fornecedor e não pode ser salvo como contrato.' using errcode = 'P0001';
    end if;
    if date_trunc('milliseconds', v_item_atual.atualizado_em) is distinct from date_trunc('milliseconds', p_atualizado_em) then
      raise exception 'O contrato foi alterado por outra pessoa. Recarregue a página.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.itens_financeiros i where i.codigo = v_codigo and i.id <> p_id) then
      raise exception 'Já existe um contrato com este código.' using errcode = 'P0001';
    end if;

    -- O trigger itens_financeiros_definir_atualizado_em atualiza o atualizado_em neste mesmo update.
    update public.itens_financeiros
       set descricao = v_descricao,
           valor_contratado_centavos = v_valor,
           observacao = v_observacao,
           codigo = v_codigo,
           versao = v_versao,
           assinado_em = v_assinado,
           documento_id = v_documento
     where id = p_id;
    v_item := p_id;
  end if;

  -- Projetos do contrato: substitui o conjunto.
  delete from public.item_financeiro_projetos x
   where x.item_id = v_item and x.projeto_id <> all (v_projetos);
  insert into public.item_financeiro_projetos (item_id, projeto_id)
  select v_item, u.projeto from unnest(v_projetos) as u(projeto)
  on conflict do nothing;

  -- Parcelas que já existem: as que vieram precisam ser do contrato; as que não vieram são apagadas, menos a que já
  -- tem pagamento. As parcelas ficam trancadas para o pagamento concorrente esperar.
  perform 1 from public.parcelas pa where pa.item_id = v_item for update;

  for v_parcela in select e.valor from jsonb_array_elements(v_parcelas) as e(valor) loop
    if not public.financeiro_json_vazio(v_parcela -> 'id') then
      v_id_lido := public.financeiro_ler_uuid(public.financeiro_json_texto(v_parcela -> 'id'));
      if v_id_lido is null then
        raise exception 'O identificador de uma parcela é inválido.' using errcode = '22023';
      end if;
      v_ids := v_ids || v_id_lido;
    end if;
  end loop;
  if (select count(distinct u) from unnest(v_ids) as u) <> cardinality(v_ids) then
    raise exception 'Há parcelas repetidas na lista.' using errcode = '22023';
  end if;
  if (select count(*) from public.parcelas pa where pa.item_id = v_item and pa.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Alguma parcela não pertence a este contrato.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.parcelas pa
     where pa.item_id = v_item and pa.id <> all (v_ids)
       and (pa.data_pagamento is not null or pa.valor_pago_centavos > 0)
  ) then
    raise exception 'Parcela com pagamento registrado não pode ser removida do contrato.' using errcode = 'P0001';
  end if;
  delete from public.parcelas pa where pa.item_id = v_item and pa.id <> all (v_ids);

  -- A numeração troca de lugar dentro desta transação; a unicidade só vale no fim, mesmo que o chamador a tenha deixado
  -- em "immediate".
  set constraints public.parcelas_item_numero_key deferred;

  for v_parcela in select e.valor from jsonb_array_elements(v_parcelas) with ordinality as e(valor, ordem) order by e.ordem loop
    v_posicao := v_posicao + 1;

    if jsonb_typeof(v_parcela) <> 'object' then
      raise exception 'Uma das parcelas é inválida.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_parcela) k
       where k not in ('id', 'nome', 'valor_previsto_centavos', 'gatilho', 'vencimento', 'evento_tipo',
                       'evento_projeto_id', 'evento_descricao', 'dias_apos')
    ) then
      raise exception 'Uma das parcelas tem um campo desconhecido.' using errcode = '22023';
    end if;

    v_nome := btrim(public.financeiro_json_texto(v_parcela -> 'nome'));
    if v_nome is null or char_length(v_nome) not between 1 and 120 then
      raise exception 'Informe o nome da parcela (até 120 caracteres).' using errcode = '22023';
    end if;

    v_texto := public.financeiro_json_texto(v_parcela -> 'valor_previsto_centavos');
    if v_texto is null or v_texto !~ '^[0-9]{1,15}$' then
      raise exception 'O valor de uma parcela é inválido.' using errcode = '22023';
    end if;
    v_valor_parcela := v_texto::bigint;

    v_gatilho := public.financeiro_json_texto(v_parcela -> 'gatilho');
    if v_gatilho is null or v_gatilho not in ('data', 'evento') then
      raise exception 'O gatilho de uma parcela é inválido.' using errcode = '22023';
    end if;

    v_dias := 0;
    if not public.financeiro_json_vazio(v_parcela -> 'dias_apos') then
      v_texto := case when jsonb_typeof(v_parcela -> 'dias_apos') = 'number' then v_parcela ->> 'dias_apos' end;
      if v_texto is null or v_texto !~ '^[0-9]{1,4}$' then
        raise exception 'Os dias após o evento são inválidos (0 a 3650).' using errcode = '22023';
      end if;
      v_dias := v_texto::integer;
      if v_dias > 3650 then
        raise exception 'Os dias após o evento são inválidos (0 a 3650).' using errcode = '22023';
      end if;
    end if;

    v_vencimento := null;
    v_tipo := null;
    v_projeto := null;
    v_descricao_evento := null;

    if v_gatilho = 'data' then
      if v_dias <> 0
         or not public.financeiro_json_vazio(v_parcela -> 'evento_tipo')
         or not public.financeiro_json_vazio(v_parcela -> 'evento_projeto_id')
         or not public.financeiro_json_vazio(v_parcela -> 'evento_descricao') then
        raise exception 'Parcela com data fixa não leva evento nem dias.' using errcode = '22023';
      end if;
      v_vencimento := public.financeiro_ler_data(public.financeiro_json_texto(v_parcela -> 'vencimento'));
      if v_vencimento is null or v_vencimento < date '2000-01-01' or v_vencimento > date '2100-12-31' then
        raise exception 'Informe o vencimento da parcela.' using errcode = '22023';
      end if;
    else
      if not public.financeiro_json_vazio(v_parcela -> 'vencimento') then
        raise exception 'Parcela por evento não leva vencimento: ele é calculado pelo evento.' using errcode = '22023';
      end if;
      v_tipo := public.financeiro_json_texto(v_parcela -> 'evento_tipo');
      if v_tipo is null or v_tipo not in ('assinatura', 'protocolo', 'aprovacao', 'entrega', 'doacoes_protocolo',
                                          'doacoes_liberacao', 'tro_pedido', 'tro_liberacao',
                                          'urbanistico_aprovacao', 'outro') then
        raise exception 'Informe o evento da parcela.' using errcode = '22023';
      end if;

      if not public.financeiro_json_vazio(v_parcela -> 'evento_projeto_id') then
        if v_tipo not in ('protocolo', 'aprovacao', 'entrega') then
          raise exception 'Este evento não leva projeto.' using errcode = '22023';
        end if;
        v_projeto := public.financeiro_ler_uuid(public.financeiro_json_texto(v_parcela -> 'evento_projeto_id'));
        if v_projeto is null then
          raise exception 'O projeto de uma parcela é inválido.' using errcode = '22023';
        end if;
      end if;
      if v_tipo in ('protocolo', 'aprovacao') and v_projeto is null then
        raise exception 'Informe o projeto do evento da parcela.' using errcode = '22023';
      end if;
      if v_projeto is not null and not (v_projeto = any (v_projetos)) then
        raise exception 'O projeto da parcela precisa estar entre os projetos do contrato.' using errcode = 'P0001';
      end if;

      if not public.financeiro_json_vazio(v_parcela -> 'evento_descricao') then
        if v_tipo <> 'outro' then
          raise exception 'Só o evento "outro" leva descrição.' using errcode = '22023';
        end if;
        v_descricao_evento := btrim(public.financeiro_json_texto(v_parcela -> 'evento_descricao'));
        if v_descricao_evento is null or char_length(v_descricao_evento) not between 1 and 120 then
          raise exception 'A descrição do evento é inválida (até 120 caracteres).' using errcode = '22023';
        end if;
      end if;
      if v_tipo = 'outro' and v_descricao_evento is null then
        raise exception 'Descreva o evento da parcela.' using errcode = '22023';
      end if;
    end if;

    v_parcela_id := public.financeiro_ler_uuid(public.financeiro_json_texto(v_parcela -> 'id'));

    if v_parcela_id is null then
      insert into public.parcelas (
        item_id, nome, numero, valor_previsto_centavos, vencimento, gatilho,
        evento_tipo, evento_projeto_id, evento_descricao, dias_apos
      )
      values (
        v_item, v_nome, v_posicao, v_valor_parcela, v_vencimento, v_gatilho,
        v_tipo, v_projeto, v_descricao_evento, v_dias
      );
    else
      -- Parcela por evento cuja regra não mudou guarda vencimento e evento_id; mudou, volta a aguardar e o recálculo
      -- abaixo preenche de novo.
      select (pa.gatilho = 'evento' and v_gatilho = 'evento'
              and (pa.evento_tipo, pa.evento_projeto_id, pa.evento_descricao, pa.dias_apos)
                  is not distinct from (v_tipo, v_projeto, v_descricao_evento, v_dias))
        into v_mantem
        from public.parcelas pa
       where pa.id = v_parcela_id;

      update public.parcelas pa
         set nome = v_nome,
             numero = v_posicao,
             valor_previsto_centavos = v_valor_parcela,
             gatilho = v_gatilho,
             evento_tipo = v_tipo,
             evento_projeto_id = v_projeto,
             evento_descricao = v_descricao_evento,
             dias_apos = v_dias,
             vencimento = case
               when v_gatilho = 'data' then v_vencimento
               when v_mantem then pa.vencimento
             end,
             evento_id = case when v_mantem then pa.evento_id end
       where pa.id = v_parcela_id and pa.item_id = v_item;
    end if;
  end loop;

  perform set_config('aba.financeiro_interno', coalesce(v_bandeira_antes, ''), true);

  -- Assinatura: o evento acompanha assinado_em. Data nova troca o evento (o antigo fica desfeito); sem data, só desfaz.
  select e.* into v_evento
    from public.financeiro_eventos e
   where e.tipo = 'assinatura' and e.item_id = v_item and e.desfeito_em is null;
  v_tem_assinatura := found;

  if not (v_tem_assinatura and v_assinado is not distinct from v_evento.ocorrido_em) then
    if v_tem_assinatura then
      update public.financeiro_eventos
         set desfeito_em = clock_timestamp(), desfeito_por = (select auth.uid())
       where id = v_evento.id;
    end if;
    if v_assinado is not null then
      insert into public.financeiro_eventos (empreendimento_id, tipo, item_id, ocorrido_em, origem, criado_por)
      values (p_empreendimento, 'assinatura', v_item, v_assinado, 'contrato', (select auth.uid()));
    end if;
  end if;

  perform public.financeiro_recalcular_vencimentos(p_empreendimento);
  return v_item;
end;
$$;

revoke execute on function public.salvar_contrato_portal(uuid, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.salvar_contrato_portal(uuid, uuid, jsonb, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. A cobrar
-- ---------------------------------------------------------------------------

-- Security invoker: o RLS de itens_financeiros e parcelas vale. Parcelas de contratos da ABA (sem fornecedor) ainda não
-- quitadas (mesma regra da view parcelas_situacao), com vencimento até hoje + p_dias; as vencidas entram sempre. Parcela
-- que aguarda evento (sem vencimento) fica de fora. O dia é o de Brasília.
create function public.listar_a_cobrar(p_dias integer default 15)
returns table (
  parcela_id uuid,
  item_id uuid,
  empreendimento_id uuid,
  empreendimento_nome text,
  codigo text,
  versao integer,
  descricao text,
  nome text,
  numero integer,
  total_parcelas integer,
  vencimento date,
  saldo_centavos text,
  vencida boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not (select public.tem_permissao('financeiro.ver')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_dias is null or p_dias not between 0 and 90 then
    raise exception 'O prazo precisa estar entre 0 e 90 dias.' using errcode = '22023';
  end if;

  return query
  select c.parcela_id, c.item_id, c.empreendimento_id, c.empreendimento_nome, c.codigo, c.versao, c.descricao,
         c.nome, c.numero, c.total_parcelas, c.vencimento, c.saldo_centavos, c.vencida
    from (
      select pa.id as parcela_id,
             i.id as item_id,
             i.empreendimento_id as empreendimento_id,
             public.nome_empreendimento(i.empreendimento_id) as empreendimento_nome,
             i.codigo as codigo,
             i.versao as versao,
             i.descricao as descricao,
             pa.nome as nome,
             pa.numero as numero,
             (select count(*)::integer from public.parcelas t where t.item_id = i.id) as total_parcelas,
             pa.vencimento as vencimento,
             (pa.valor_previsto_centavos - pa.valor_pago_centavos)::text as saldo_centavos,
             pa.vencimento < v_hoje as vencida
        from public.parcelas pa
        join public.itens_financeiros i on i.id = pa.item_id
       where i.fornecedor_id is null
         and pa.data_pagamento is null
         and pa.valor_pago_centavos < pa.valor_previsto_centavos
         and pa.vencimento is not null
         and pa.vencimento <= v_hoje + p_dias
    ) c
   order by c.vencimento, c.empreendimento_nome, c.numero, c.parcela_id;
end;
$$;

revoke execute on function public.listar_a_cobrar(integer) from public, anon;
grant execute on function public.listar_a_cobrar(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Eventos do que já aconteceu
-- ---------------------------------------------------------------------------

-- Protocolo (e a entrega de origem protocolo) dos projetos com etapa de marco análise que já chegaram lá: há sinal de
-- protocolo aplicado e não ignorado, ou mudança de etapa ainda valendo para uma etapa de ordem >= análise, ou a etapa
-- atual é de ordem >= análise. Data = a menor entre o dia do sinal, o dia da mudança e a conclusão da etapa anterior à
-- análise; sem nenhuma data, não cria (a tela do contrato avisa e oferece o botão). Aprovação: a etapa atual tem ordem
-- >= aprovado; data = conclusão da etapa aprovada, senão a menor entre o sinal e a mudança. Dias de Brasília.
-- Não recalcula: quando a migration roda não há parcela por evento. Sem grant; fica no banco para o teste. O índice dos
-- eventos ativos barra duplicata, mas repetir recria o evento que alguém desfez à mão (o projeto continua além da etapa):
-- é para rodar uma vez, aqui.
create function public.financeiro_eventos_retroativos()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha record;
begin
  for v_linha in
    select b.empreendimento_id, b.projeto_id, b.ocorrido_em, b.historico_id
      from (
        select p.id as projeto_id,
               p.empreendimento_id as empreendimento_id,
               least(
                 (select min((s.data_arquivo at time zone 'America/Sao_Paulo')::date)
                    from public.etapa_sinais s
                   where s.projeto_id = p.id and s.tipo = 'protocolo' and s.aplicado_em is not null and s.ignorado_em is null),
                 (select min((h.em at time zone 'America/Sao_Paulo')::date)
                    from public.projeto_etapa_historico h
                    join public.projeto_etapas t on t.id = h.para_etapa_id
                   where h.projeto_id = p.id and h.desfeito_em is null and h.origem <> 'desfazer' and t.ordem >= an.ordem),
                 (select e.concluida_em from public.projeto_etapas e
                   where e.projeto_id = p.id and e.ordem < an.ordem
                   order by e.ordem desc limit 1)
               ) as ocorrido_em,
               (select h.id
                  from public.projeto_etapa_historico h
                  join public.projeto_etapas t on t.id = h.para_etapa_id
                 where h.projeto_id = p.id and h.desfeito_em is null and h.origem <> 'desfazer' and t.ordem >= an.ordem
                 order by h.em, h.id limit 1) as historico_id
          from public.projetos p
          join public.projeto_etapas an on an.projeto_id = p.id and an.marco = 'analise'
         where exists (
                 select 1 from public.etapa_sinais s
                  where s.projeto_id = p.id and s.tipo = 'protocolo' and s.aplicado_em is not null and s.ignorado_em is null)
            or exists (
                 select 1 from public.projeto_etapa_historico h
                   join public.projeto_etapas t on t.id = h.para_etapa_id
                  where h.projeto_id = p.id and h.desfeito_em is null and h.origem <> 'desfazer' and t.ordem >= an.ordem)
            or exists (
                 select 1 from public.projeto_etapas atual
                  where atual.id = p.etapa_atual_id and atual.ordem >= an.ordem)
      ) b
     where b.ocorrido_em is not null
  loop
    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, historico_id, criado_por)
    values (v_linha.empreendimento_id, 'protocolo', v_linha.projeto_id, v_linha.ocorrido_em, 'etapas', v_linha.historico_id, null)
    on conflict do nothing;
    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, historico_id, criado_por)
    values (v_linha.empreendimento_id, 'entrega', v_linha.projeto_id, v_linha.ocorrido_em, 'protocolo', v_linha.historico_id, null)
    on conflict do nothing;
  end loop;

  for v_linha in
    select b.empreendimento_id, b.projeto_id, b.ocorrido_em, b.historico_id
      from (
        select p.id as projeto_id,
               p.empreendimento_id as empreendimento_id,
               least(
                 ap.concluida_em,
                 (select min((s.data_arquivo at time zone 'America/Sao_Paulo')::date)
                    from public.etapa_sinais s
                   where s.projeto_id = p.id and s.tipo = 'aprovado' and s.aplicado_em is not null and s.ignorado_em is null),
                 (select min((h.em at time zone 'America/Sao_Paulo')::date)
                    from public.projeto_etapa_historico h
                    join public.projeto_etapas t on t.id = h.para_etapa_id
                   where h.projeto_id = p.id and h.desfeito_em is null and h.origem <> 'desfazer' and t.ordem >= ap.ordem)
               ) as ocorrido_em,
               (select h.id
                  from public.projeto_etapa_historico h
                  join public.projeto_etapas t on t.id = h.para_etapa_id
                 where h.projeto_id = p.id and h.desfeito_em is null and h.origem <> 'desfazer' and t.ordem >= ap.ordem
                 order by h.em, h.id limit 1) as historico_id
          from public.projetos p
          join public.projeto_etapas ap on ap.projeto_id = p.id and ap.marco = 'aprovado'
          join public.projeto_etapas atual on atual.id = p.etapa_atual_id and atual.ordem >= ap.ordem
      ) b
     where b.ocorrido_em is not null
  loop
    insert into public.financeiro_eventos (empreendimento_id, tipo, projeto_id, ocorrido_em, origem, historico_id, criado_por)
    values (v_linha.empreendimento_id, 'aprovacao', v_linha.projeto_id, v_linha.ocorrido_em, 'etapas', v_linha.historico_id, null)
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function public.financeiro_eventos_retroativos() from public, anon, authenticated, service_role;

select public.financeiro_eventos_retroativos();

commit;
