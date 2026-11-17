-- Etapa 7, frente B — modelo de dados do conector (documentos do servidor para o portal).
-- Contrato: docs/ETAPA-7-CONTRATO.md (§4, §5, §7.2, §13 D1/D7/D8).
-- Toda tabela nova ativa RLS nesta mesma migration. Nenhuma é acessível ao anon.
-- Os dados de origem (caminho no servidor, hash) ficam FORA de documentos: o cliente lê linhas
-- de documentos (RLS por linha, não por coluna) e o caminho tem nomes de pessoas.
-- Escritas do conector (API com a chave de servidor) usam a secret key, que ignora o RLS.
begin;

-- ---------------------------------------------------------------------------
-- 1. empreendimentos: pasta do servidor e interruptor de liberação automática (D1).
-- ---------------------------------------------------------------------------

-- [0-9] e não \d: \d pode casar dígitos de outros alfabetos conforme o locale.
alter table public.empreendimentos
  add column codigo_pasta text,
  add column liberacao_automatica boolean not null default false,
  add constraint empreendimentos_codigo_pasta_key unique (codigo_pasta),
  add constraint empreendimentos_codigo_pasta_check check (codigo_pasta ~ '^[0-9]{6}$');

-- ---------------------------------------------------------------------------
-- 2. documentos: grupo (D8) e revisão (D7).
-- ---------------------------------------------------------------------------

alter table public.documentos
  add column grupo text,
  add column substitui_id uuid references public.documentos (id) on delete set null,
  add constraint documentos_grupo_check check (grupo in ('contratos', 'orcamentos')),
  add constraint documentos_grupo_sem_projeto_check check (grupo is null or projeto_id is null),
  add constraint documentos_substitui_id_check check (substitui_id is null or substitui_id <> id);

create index documentos_substitui_id_idx on public.documentos (substitui_id) where substitui_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Caminho relativo válido (pasta_regras e documento_origens).
-- ---------------------------------------------------------------------------

-- Normalizado em NFC, sem segmento vazio, "." ou ".." (aceita "/" e "\" como separador), sem ":" (letra
-- de unidade) e até 1000 caracteres. Imutável, para servir em CHECK. Mantém o EXECUTE padrão: o CHECK é
-- avaliado com o privilégio de quem grava.
create function public.caminho_relativo_valido(p_caminho text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_caminho is not null
    and char_length(p_caminho) between 1 and 1000
    and p_caminho is nfc normalized
    and position(':' in p_caminho) = 0
    and not (array['', '.', '..'] && string_to_array(replace(p_caminho, chr(92), '/'), '/'))
$$;

-- ---------------------------------------------------------------------------
-- 4. conectores (chave de servidor). Criada antes das regras/origens que a citam.
-- ---------------------------------------------------------------------------

create table public.conectores (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  -- sha256 em hexadecimal da chave "abacon_...". A chave em si nunca é guardada.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  criado_por uuid references public.profiles (id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  revogado_em timestamptz,
  ultimo_contato_em timestamptz,
  versao text check (char_length(versao) <= 40),
  ultimo_ciclo jsonb check (octet_length(ultimo_ciclo::text) <= 262144),
  arvore jsonb check (octet_length(arvore::text) <= 2097152)
);

-- No máximo um conector ativo: emitir uma nova chave exige revogar a anterior antes.
create unique index conectores_um_ativo_idx on public.conectores ((true)) where revogado_em is null;
create index conectores_criado_por_idx on public.conectores (criado_por);

-- A chave não troca e uma revogação não se desfaz (nem pela secret key, por engano).
create function public.proteger_conector()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token_hash is distinct from old.token_hash then
    raise exception 'A chave de um conector não pode ser trocada.' using errcode = '23514';
  end if;
  if old.revogado_em is not null and new.revogado_em is distinct from old.revogado_em then
    raise exception 'Conector revogado não pode ser reativado.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_conector() from public, anon, authenticated;

create trigger conectores_proteger
  before update on public.conectores
  for each row execute function public.proteger_conector();

-- Auditoria própria: a genérica gravaria token_hash e a árvore de pastas em auditoria (lida por admin),
-- e o conector atualiza ultimo_contato_em/ultimo_ciclo a cada ciclo (ruído). Só emitir, renomear,
-- revogar e apagar são registrados.
create function public.registrar_auditoria_conector()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria (tabela, registro_id, acao, ator_id, antes, depois)
    values (tg_table_name, new.id, tg_op, (select auth.uid()), null,
            to_jsonb(new) - 'token_hash' - 'arvore' - 'ultimo_ciclo');
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.auditoria (tabela, registro_id, acao, ator_id, antes, depois)
    values (tg_table_name, new.id, tg_op, (select auth.uid()),
            to_jsonb(old) - 'token_hash' - 'arvore' - 'ultimo_ciclo',
            to_jsonb(new) - 'token_hash' - 'arvore' - 'ultimo_ciclo');
    return new;
  end if;

  insert into public.auditoria (tabela, registro_id, acao, ator_id, antes, depois)
  values (tg_table_name, old.id, tg_op, (select auth.uid()),
          to_jsonb(old) - 'token_hash' - 'arvore' - 'ultimo_ciclo', null);
  return old;
end;
$$;

revoke execute on function public.registrar_auditoria_conector() from public, anon, authenticated;

create trigger conectores_registrar_auditoria
  after insert or delete or update of nome, revogado_em, token_hash on public.conectores
  for each row execute function public.registrar_auditoria_conector();

-- ---------------------------------------------------------------------------
-- 5. pasta_regras
-- ---------------------------------------------------------------------------

create table public.pasta_regras (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  -- Caminho no servidor da empresa, relativo à pasta do empreendimento. Não é arquivo do Storage/R2:
  -- por isso não termina em _path (a limpeza de órfãos trataria o valor como referência a um objeto).
  caminho_prefixo text not null check (public.caminho_relativo_valido(caminho_prefixo) and char_length(caminho_prefixo) <= 500),
  -- Destino: projeto (com categoria opcional) OU grupo do empreendimento.
  projeto_id uuid references public.projetos (id) on delete cascade,
  categoria_id uuid references public.projeto_categorias_documento (id) on delete set null,
  grupo text check (grupo in ('contratos', 'orcamentos')),
  liberar_automatico boolean not null default false,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empreendimento_id, caminho_prefixo),
  constraint pasta_regras_destino_check check (
    (projeto_id is not null and grupo is null)
    or (projeto_id is null and categoria_id is null and grupo is not null)
  ),
  -- Segunda barreira: a lista de bloqueio do §5 vale acima de qualquer regra (a primeira é o código do site).
  constraint pasta_regras_bloqueio_check check (
    caminho_prefixo !~* '(dados do empreendedor|comprovante|notas fiscais|planilha)'
  )
);

create index pasta_regras_projeto_id_idx on public.pasta_regras (projeto_id);
create index pasta_regras_categoria_id_idx on public.pasta_regras (categoria_id);

-- Projeto do mesmo empreendimento e categoria do mesmo projeto (FK simples não garante).
-- Só revalida quando o vínculo muda para um valor novo: ao apagar um projeto, a FK da categoria faz
-- SET NULL depois de o projeto já ter sumido, e revalidar aí bloquearia a exclusão.
create function public.validar_pasta_regra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revalidar boolean;
begin
  if tg_op = 'UPDATE' then
    if new.empreendimento_id <> old.empreendimento_id then
      raise exception 'Regra não pode ser transferida.' using errcode = '23514';
    end if;
    v_revalidar := new.projeto_id is distinct from old.projeto_id
      or (new.categoria_id is not null and new.categoria_id is distinct from old.categoria_id);
  else
    v_revalidar := true;
  end if;

  if v_revalidar and new.projeto_id is not null then
    if not exists (
      select 1 from public.projetos p
      where p.id = new.projeto_id and p.empreendimento_id = new.empreendimento_id
    ) then
      raise exception 'Projeto não pertence ao empreendimento.' using errcode = '23514';
    end if;
    if new.categoria_id is not null and not exists (
      select 1 from public.projeto_categorias_documento c
      where c.id = new.categoria_id and c.projeto_id = new.projeto_id
    ) then
      raise exception 'Categoria não pertence ao projeto.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_pasta_regra() from public, anon, authenticated;

create trigger pasta_regras_validar
  before insert or update on public.pasta_regras
  for each row execute function public.validar_pasta_regra();

-- ---------------------------------------------------------------------------
-- 6. configuracoes_conector: linha única
-- ---------------------------------------------------------------------------

-- id uuid (e não boolean) porque registrar_auditoria() grava new.id em auditoria.registro_id (uuid);
-- a unicidade da linha vem de "unica".
create table public.configuracoes_conector (
  id uuid primary key default gen_random_uuid(),
  unica boolean not null default true unique check (unica),
  liberacao_automatica_geral boolean not null default true,
  atualizado_em timestamptz not null default now()
);

insert into public.configuracoes_conector (unica) values (true);

-- ---------------------------------------------------------------------------
-- 7. documento_origens
-- ---------------------------------------------------------------------------

create table public.documento_origens (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null unique references public.documentos (id) on delete cascade,
  conector_id uuid references public.conectores (id) on delete set null,
  regra_id uuid references public.pasta_regras (id) on delete set null,
  -- Caminho no servidor da empresa (não é arquivo do Storage/R2; ver pasta_regras).
  caminho_relativo text not null check (public.caminho_relativo_valido(caminho_relativo)),
  tamanho bigint not null check (tamanho > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mtime timestamptz,
  criado_em timestamptz not null default now()
);

create index documento_origens_conector_id_idx on public.documento_origens (conector_id);
create index documento_origens_regra_id_idx on public.documento_origens (regra_id);
create index documento_origens_caminho_idx on public.documento_origens (caminho_relativo);

-- ---------------------------------------------------------------------------
-- 8. conector_envios (registro de cada autorização; base dos limites diários)
-- ---------------------------------------------------------------------------

-- Sem validação rígida do caminho: envios recusados registram justamente o caminho recusado.
create table public.conector_envios (
  id uuid primary key default gen_random_uuid(),
  conector_id uuid not null references public.conectores (id) on delete restrict,
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  regra_id uuid references public.pasta_regras (id) on delete set null,
  caminho_relativo text not null check (char_length(caminho_relativo) between 1 and 2000),
  tamanho bigint not null check (tamanho >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  estado text not null default 'autorizado' check (estado in ('autorizado', 'confirmado', 'recusado', 'duplicado')),
  documento_id uuid references public.documentos (id) on delete set null,
  erro text check (char_length(erro) <= 2000),
  em timestamptz not null default now()
);

-- Duplicado: o mesmo conteúdo confirmado no mesmo empreendimento não entra de novo.
create unique index conector_envios_confirmado_sha256_idx
  on public.conector_envios (empreendimento_id, sha256) where estado = 'confirmado';
-- Limites diários por conector (200 envios, 2 GB) e por hora (requisições).
create index conector_envios_conector_em_idx on public.conector_envios (conector_id, em desc);
create index conector_envios_regra_id_idx on public.conector_envios (regra_id);
create index conector_envios_documento_id_idx on public.conector_envios (documento_id);

-- ---------------------------------------------------------------------------
-- 9. atualizado_em e auditoria
-- ---------------------------------------------------------------------------

-- conector_envios é, ele mesmo, o registro de eventos (volume alto): sem auditoria.
create trigger pasta_regras_definir_atualizado_em
  before update on public.pasta_regras
  for each row execute function public.definir_atualizado_em();

create trigger configuracoes_conector_definir_atualizado_em
  before update on public.configuracoes_conector
  for each row execute function public.definir_atualizado_em();

create trigger pasta_regras_registrar_auditoria
  after insert or update or delete on public.pasta_regras
  for each row execute function public.registrar_auditoria();

create trigger configuracoes_conector_registrar_auditoria
  after insert or update or delete on public.configuracoes_conector
  for each row execute function public.registrar_auditoria();

create trigger documento_origens_registrar_auditoria
  after insert or update or delete on public.documento_origens
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------------------
-- 10. RLS e grants
-- ---------------------------------------------------------------------------

alter table public.conectores enable row level security;
alter table public.pasta_regras enable row level security;
alter table public.configuracoes_conector enable row level security;
alter table public.documento_origens enable row level security;
alter table public.conector_envios enable row level security;

revoke all on table public.conectores from anon;
revoke all on table public.pasta_regras from anon;
revoke all on table public.configuracoes_conector from anon;
revoke all on table public.documento_origens from anon;
revoke all on table public.conector_envios from anon;

revoke all on table public.conectores from authenticated;
revoke all on table public.pasta_regras from authenticated;
revoke all on table public.configuracoes_conector from authenticated;
revoke all on table public.documento_origens from authenticated;
revoke all on table public.conector_envios from authenticated;

-- conectores: token_hash não está em nenhuma lista de colunas abaixo, então nenhum usuário logado o lê
-- (nem o admin); só a secret key. Escolhi privilégio por coluna em vez de view: a view precisaria ser
-- security definer para ler a tabela, e privilégio por coluna é checado pelo próprio banco. Contrapartida:
-- "select *" em conectores falha para authenticated; o código deve listar as colunas.
grant select (id, nome, criado_por, criado_em, revogado_em, ultimo_contato_em, versao, ultimo_ciclo, arvore)
  on table public.conectores to authenticated;
grant insert (nome, token_hash) on table public.conectores to authenticated;
grant update (nome, revogado_em) on table public.conectores to authenticated;

grant select, insert, update, delete on table public.pasta_regras to authenticated;
-- A linha única nasce nesta migration: ninguém cria nem apaga, a equipe só liga/desliga.
grant select on table public.configuracoes_conector to authenticated;
grant update (liberacao_automatica_geral) on table public.configuracoes_conector to authenticated;
-- Escritas de origem e de envio vêm só do conector (secret key); a equipe só consulta.
grant select on table public.documento_origens to authenticated;
grant select on table public.conector_envios to authenticated;

create policy "staff lê conectores"
  on public.conectores
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "admin emite conector"
  on public.conectores
  for insert
  to authenticated
  with check ((select public.e_admin()) and criado_por = (select auth.uid()));

create policy "admin revoga conector"
  on public.conectores
  for update
  to authenticated
  using ((select public.e_admin()))
  with check ((select public.e_admin()));

create policy "staff gerencia regras de pasta"
  on public.pasta_regras
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff lê a configuração do conector"
  on public.configuracoes_conector
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "staff altera a configuração do conector"
  on public.configuracoes_conector
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff lê origens de documentos"
  on public.documento_origens
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "staff lê envios do conector"
  on public.conector_envios
  for select
  to authenticated
  using ((select public.e_staff()));

-- ---------------------------------------------------------------------------
-- 11. Revisões (D7): o cliente nunca vê duas versões do mesmo arquivo.
-- ---------------------------------------------------------------------------

-- Revisão nova nasce oculta e aponta para a anterior (substitui_id). A política de leitura do cliente
-- não muda: a garantia vem de que, quando uma versão é liberada, as outras da mesma "família" (a
-- cadeia de revisões) saem do ar na mesma instrução. Vale para qualquer caminho: a função abaixo, o
-- UPDATE direto da equipe e o INSERT já liberado da liberação automática.
create function public.validar_substituicao_documento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.substitui_id is not distinct from old.substitui_id then
      return new;
    end if;
    -- Só pode zerar (ação ON DELETE SET NULL da FK). Reapontar poderia criar ciclo.
    if new.substitui_id is not null then
      raise exception 'Revisão não pode ser reapontada.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.substitui_id is not null then
    if not exists (
      select 1 from public.documentos d
      where d.id = new.substitui_id and d.empreendimento_id = new.empreendimento_id
    ) then
      raise exception 'Revisão deve substituir documento do mesmo empreendimento.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_substituicao_documento() from public, anon, authenticated;

create trigger documentos_validar_substituicao
  before insert or update on public.documentos
  for each row execute function public.validar_substituicao_documento();

create function public.ocultar_versoes_irmas_documento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.liberado_cliente then
      return null;
    end if;
  end if;
  if not new.liberado_cliente then
    return null;
  end if;

  update public.documentos d
     set liberado_cliente = false
   where d.liberado_cliente
     and d.id <> new.id
     and d.id in (
       with recursive acima as (
         select x.id, x.substitui_id from public.documentos x where x.id = new.id
         union
         select x.id, x.substitui_id from public.documentos x join acima a on x.id = a.substitui_id
       ), familia as (
         select a.id from acima a where a.substitui_id is null
         union
         select x.id from public.documentos x join familia f on x.substitui_id = f.id
       )
       select f.id from familia f
     );

  return null;
end;
$$;

revoke execute on function public.ocultar_versoes_irmas_documento() from public, anon, authenticated;

create trigger documentos_ocultar_versoes_irmas
  after insert or update of liberado_cliente on public.documentos
  for each row execute function public.ocultar_versoes_irmas_documento();

-- Liberar a revisão: libera a nova e oculta a anterior numa transação só. Idempotente.
create function public.liberar_revisao_documento(p_documento uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_substitui uuid;
  v_liberado boolean;
begin
  if not (select public.e_staff()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  select d.substitui_id, d.liberado_cliente
    into v_substitui, v_liberado
    from public.documentos d
   where d.id = p_documento
   for update;

  if not found then
    raise exception 'Documento não encontrado.' using errcode = 'P0002';
  end if;
  if v_substitui is null then
    raise exception 'O documento não é uma revisão.' using errcode = '23514';
  end if;
  if v_liberado then
    return;
  end if;

  -- O trigger documentos_ocultar_versoes_irmas oculta a anterior (e o resto da cadeia) neste UPDATE.
  update public.documentos
     set liberado_cliente = true
   where id = p_documento;
end;
$$;

revoke execute on function public.liberar_revisao_documento(uuid) from public, anon;
grant execute on function public.liberar_revisao_documento(uuid) to authenticated;

commit;
