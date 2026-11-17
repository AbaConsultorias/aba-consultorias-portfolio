-- Etapa 2, parte B — operação: fornecedores, empreendimentos, projetos, obras e relatos.
-- Contrato: docs/ETAPA-2-CONTRATO.md (seção "B"). Depende da migration A
-- (public.loteamentos) e da base da Etapa 1 (papel_atual, e_staff, auditoria).
-- Toda tabela abaixo ativa RLS nesta mesma migration, sem acesso para anon.
-- Escrita de staff passa pelo RLS com o client da sessão; relatos de obra são a
-- única escrita de não-staff (empreiteiro), travada na política de insert.

create type public.obra_situacao as enum (
  'planejada',
  'em_andamento',
  'concluida'
);

create type public.revisao_status as enum (
  'pendente',
  'aprovado',
  'devolvido'
);

-- Fornecedores e seus usuários de acesso.
create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  nome_fantasia text,
  cnpj text unique,
  contato_nome text,
  telefone text,
  email text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.fornecedor_usuarios (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (fornecedor_id, profile_id)
);

create index fornecedor_usuarios_profile_idx on public.fornecedor_usuarios (profile_id);

-- Empreendimentos e seus clientes.
create table public.empreendimentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text,
  descricao text,
  situacao text not null default 'ativo' check (situacao in ('ativo', 'concluido', 'arquivado')),
  loteamento_id uuid references public.loteamentos (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index empreendimentos_loteamento_idx on public.empreendimentos (loteamento_id);

create table public.empreendimento_clientes (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empreendimento_id, profile_id)
);

create index empreendimento_clientes_profile_idx on public.empreendimento_clientes (profile_id);

-- Modelos de etapas (cadastro da ABA) e o que o projeto copia deles.
create table public.modelos_etapas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.modelo_etapas_itens (
  id uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references public.modelos_etapas (id) on delete cascade,
  nome text not null,
  ordem int not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (modelo_id, ordem)
);

create table public.modelo_categorias_documento (
  id uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references public.modelos_etapas (id) on delete cascade,
  nome text not null,
  ordem int not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (modelo_id, nome)
);

-- Projetos do empreendimento. etapa_atual_id ganha a FK depois de projeto_etapas.
create table public.projetos (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  modelo_origem_id uuid references public.modelos_etapas (id) on delete set null,
  nome text not null,
  etapa_atual_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empreendimento_id, nome)
);

create index projetos_modelo_origem_idx on public.projetos (modelo_origem_id);
create index projetos_etapa_atual_idx on public.projetos (etapa_atual_id);

-- A unicidade de (projeto_id, ordem) só é conferida no commit, para a equipe
-- poder reordenar etapas trocando os números dentro de uma transação.
create table public.projeto_etapas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  nome text not null,
  ordem int not null,
  concluida_em date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint projeto_etapas_projeto_ordem_key unique (projeto_id, ordem) deferrable initially deferred
);

alter table public.projetos
  add constraint projetos_etapa_atual_fkey
  foreign key (etapa_atual_id) references public.projeto_etapas (id) on delete set null;

create table public.projeto_categorias_documento (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  nome text not null,
  ordem int not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (projeto_id, nome)
);

-- Atualizações (visitas) que a equipe publica para o cliente.
create table public.atualizacoes (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  projeto_id uuid references public.projetos (id) on delete set null,
  etapa_id uuid references public.projeto_etapas (id) on delete set null,
  titulo text not null,
  texto text,
  data_visita date,
  publicado boolean not null default false,
  criado_por uuid references public.profiles (id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index atualizacoes_empreendimento_idx on public.atualizacoes (empreendimento_id);
create index atualizacoes_projeto_idx on public.atualizacoes (projeto_id);
create index atualizacoes_etapa_idx on public.atualizacoes (etapa_id);
create index atualizacoes_criado_por_idx on public.atualizacoes (criado_por);

create table public.atualizacao_fotos (
  id uuid primary key default gen_random_uuid(),
  atualizacao_id uuid not null references public.atualizacoes (id) on delete cascade,
  storage_path text not null unique,
  mime text not null,
  tamanho bigint not null check (tamanho > 0),
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index atualizacao_fotos_atualizacao_idx on public.atualizacao_fotos (atualizacao_id);

-- Obras, empreiteiros e relatos de obra.
create table public.obras (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete cascade,
  nome text not null,
  previsto_inicio date,
  previsto_fim date,
  situacao public.obra_situacao not null default 'planejada',
  percentual int not null default 0 check (percentual between 0 and 100),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index obras_empreendimento_idx on public.obras (empreendimento_id);

create table public.obra_empreiteiros (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (obra_id, profile_id)
);

create index obra_empreiteiros_profile_idx on public.obra_empreiteiros (profile_id);

create table public.relatos_obra (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras (id) on delete cascade,
  autor_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  texto text not null,
  percentual_informado int check (percentual_informado between 0 and 100),
  situacao_informada public.obra_situacao,
  status public.revisao_status not null default 'pendente',
  motivo_devolucao text,
  revisado_por uuid references public.profiles (id) on delete set null,
  revisado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index relatos_obra_obra_idx on public.relatos_obra (obra_id);
create index relatos_obra_autor_idx on public.relatos_obra (autor_id);
create index relatos_obra_revisado_por_idx on public.relatos_obra (revisado_por);

create table public.relato_fotos (
  id uuid primary key default gen_random_uuid(),
  relato_id uuid not null references public.relatos_obra (id) on delete cascade,
  storage_path text not null unique,
  mime text not null,
  tamanho bigint not null check (tamanho > 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index relato_fotos_relato_idx on public.relato_fotos (relato_id);

-- RLS ligado em tudo; anon nunca enxerga nada. As políticas vêm depois das funções de acesso.
alter table public.fornecedores enable row level security;
alter table public.fornecedor_usuarios enable row level security;
alter table public.empreendimentos enable row level security;
alter table public.empreendimento_clientes enable row level security;
alter table public.modelos_etapas enable row level security;
alter table public.modelo_etapas_itens enable row level security;
alter table public.modelo_categorias_documento enable row level security;
alter table public.projetos enable row level security;
alter table public.projeto_etapas enable row level security;
alter table public.projeto_categorias_documento enable row level security;
alter table public.atualizacoes enable row level security;
alter table public.atualizacao_fotos enable row level security;
alter table public.obras enable row level security;
alter table public.obra_empreiteiros enable row level security;
alter table public.relatos_obra enable row level security;
alter table public.relato_fotos enable row level security;

revoke all on table
  public.fornecedores,
  public.fornecedor_usuarios,
  public.empreendimentos,
  public.empreendimento_clientes,
  public.modelos_etapas,
  public.modelo_etapas_itens,
  public.modelo_categorias_documento,
  public.projetos,
  public.projeto_etapas,
  public.projeto_categorias_documento,
  public.atualizacoes,
  public.atualizacao_fotos,
  public.obras,
  public.obra_empreiteiros,
  public.relatos_obra,
  public.relato_fotos
from anon;

revoke all on table
  public.fornecedores,
  public.fornecedor_usuarios,
  public.empreendimentos,
  public.empreendimento_clientes,
  public.modelos_etapas,
  public.modelo_etapas_itens,
  public.modelo_categorias_documento,
  public.projetos,
  public.projeto_etapas,
  public.projeto_categorias_documento,
  public.atualizacoes,
  public.atualizacao_fotos,
  public.obras,
  public.obra_empreiteiros,
  public.relatos_obra,
  public.relato_fotos
from authenticated;

grant select, insert, update, delete on table
  public.fornecedores,
  public.fornecedor_usuarios,
  public.empreendimentos,
  public.empreendimento_clientes,
  public.modelos_etapas,
  public.modelo_etapas_itens,
  public.modelo_categorias_documento,
  public.projetos,
  public.projeto_etapas,
  public.projeto_categorias_documento,
  public.atualizacoes,
  public.atualizacao_fotos,
  public.obras,
  public.obra_empreiteiros,
  public.relatos_obra
to authenticated;

-- Foto de relato não é editada: troca-se apagando e enviando de novo.
grant select, insert, delete on table public.relato_fotos to authenticated;

-- atualizado_em sempre correto.
create trigger fornecedores_definir_atualizado_em
  before update on public.fornecedores
  for each row execute function public.definir_atualizado_em();
create trigger fornecedor_usuarios_definir_atualizado_em
  before update on public.fornecedor_usuarios
  for each row execute function public.definir_atualizado_em();
create trigger empreendimentos_definir_atualizado_em
  before update on public.empreendimentos
  for each row execute function public.definir_atualizado_em();
create trigger empreendimento_clientes_definir_atualizado_em
  before update on public.empreendimento_clientes
  for each row execute function public.definir_atualizado_em();
create trigger modelos_etapas_definir_atualizado_em
  before update on public.modelos_etapas
  for each row execute function public.definir_atualizado_em();
create trigger modelo_etapas_itens_definir_atualizado_em
  before update on public.modelo_etapas_itens
  for each row execute function public.definir_atualizado_em();
create trigger modelo_categorias_documento_definir_atualizado_em
  before update on public.modelo_categorias_documento
  for each row execute function public.definir_atualizado_em();
create trigger projetos_definir_atualizado_em
  before update on public.projetos
  for each row execute function public.definir_atualizado_em();
create trigger projeto_etapas_definir_atualizado_em
  before update on public.projeto_etapas
  for each row execute function public.definir_atualizado_em();
create trigger projeto_categorias_documento_definir_atualizado_em
  before update on public.projeto_categorias_documento
  for each row execute function public.definir_atualizado_em();
create trigger atualizacoes_definir_atualizado_em
  before update on public.atualizacoes
  for each row execute function public.definir_atualizado_em();
create trigger atualizacao_fotos_definir_atualizado_em
  before update on public.atualizacao_fotos
  for each row execute function public.definir_atualizado_em();
create trigger obras_definir_atualizado_em
  before update on public.obras
  for each row execute function public.definir_atualizado_em();
create trigger obra_empreiteiros_definir_atualizado_em
  before update on public.obra_empreiteiros
  for each row execute function public.definir_atualizado_em();
create trigger relatos_obra_definir_atualizado_em
  before update on public.relatos_obra
  for each row execute function public.definir_atualizado_em();
create trigger relato_fotos_definir_atualizado_em
  before update on public.relato_fotos
  for each row execute function public.definir_atualizado_em();

-- Auditoria nas tabelas marcadas [aud] no contrato.
create trigger fornecedores_registrar_auditoria
  after insert or update or delete on public.fornecedores
  for each row execute function public.registrar_auditoria();
create trigger fornecedor_usuarios_registrar_auditoria
  after insert or update or delete on public.fornecedor_usuarios
  for each row execute function public.registrar_auditoria();
create trigger empreendimentos_registrar_auditoria
  after insert or update or delete on public.empreendimentos
  for each row execute function public.registrar_auditoria();
create trigger empreendimento_clientes_registrar_auditoria
  after insert or update or delete on public.empreendimento_clientes
  for each row execute function public.registrar_auditoria();
create trigger projetos_registrar_auditoria
  after insert or update or delete on public.projetos
  for each row execute function public.registrar_auditoria();
create trigger obras_registrar_auditoria
  after insert or update or delete on public.obras
  for each row execute function public.registrar_auditoria();
create trigger obra_empreiteiros_registrar_auditoria
  after insert or update or delete on public.obra_empreiteiros
  for each row execute function public.registrar_auditoria();
create trigger relatos_obra_registrar_auditoria
  after insert or update or delete on public.relatos_obra
  for each row execute function public.registrar_auditoria();

-- No máximo 10 fotos por relato. Roda depois do insert (já passou pelo RLS) e
-- conta com a linha nova incluída. Security definer para contar sem passar
-- pelo RLS; o lock na linha do relato serializa dois envios simultâneos.
create function public.limitar_fotos_por_relato()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.relatos_obra r where r.id = new.relato_id for update;

  if (select count(*) from public.relato_fotos f where f.relato_id = new.relato_id) > 10 then
    raise exception 'Um relato aceita no máximo 10 fotos.' using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

revoke execute on function public.limitar_fotos_por_relato() from public, anon, authenticated;

create trigger relato_fotos_limitar_por_relato
  after insert on public.relato_fotos
  for each row execute function public.limitar_fotos_por_relato();

-- Funções de acesso. Security definer porque leem tabelas com RLS (as próprias
-- políticas as chamam): sem isso haveria recursão de política. Todas devolvem
-- false quando papel_atual() é nulo (conta inativa, troca de senha pendente ou
-- sem sessão).
create function public.cliente_do_empreendimento(p_empreendimento uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'cliente', false)
    and exists (
      select 1
      from public.empreendimento_clientes ec
      where ec.empreendimento_id = p_empreendimento
        and ec.profile_id = (select auth.uid())
    )
$$;

create function public.empreiteiro_da_obra(p_obra uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'empreiteiro', false)
    and exists (
      select 1
      from public.obra_empreiteiros oe
      where oe.obra_id = p_obra
        and oe.profile_id = (select auth.uid())
    )
$$;

create function public.usuario_do_fornecedor(p_fornecedor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'fornecedor', false)
    and exists (
      select 1
      from public.fornecedor_usuarios fu
      where fu.fornecedor_id = p_fornecedor
        and fu.profile_id = (select auth.uid())
    )
$$;

create function public.pode_ver_empreendimento(p_empreendimento uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.e_staff() or public.cliente_do_empreendimento(p_empreendimento)
$$;

revoke execute on function public.cliente_do_empreendimento(uuid) from public, anon;
revoke execute on function public.empreiteiro_da_obra(uuid) from public, anon;
revoke execute on function public.usuario_do_fornecedor(uuid) from public, anon;
revoke execute on function public.pode_ver_empreendimento(uuid) from public, anon;
grant execute on function public.cliente_do_empreendimento(uuid) to authenticated;
grant execute on function public.empreiteiro_da_obra(uuid) to authenticated;
grant execute on function public.usuario_do_fornecedor(uuid) to authenticated;
grant execute on function public.pode_ver_empreendimento(uuid) to authenticated;

-- Políticas. Padrão: uma política "staff gerencia …" (for all) e políticas de
-- leitura para os demais papéis. As linhas "a própria linha" exigem papel
-- ativo, para a conta com troca de senha pendente não ver nada; elas só
-- comparam profile_id e não chamam função que leia a mesma tabela.

-- fornecedores
create policy "staff gerencia fornecedores"
  on public.fornecedores
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "usuário lê o próprio fornecedor"
  on public.fornecedores
  for select
  to authenticated
  using (public.usuario_do_fornecedor(id));

-- fornecedor_usuarios
create policy "staff gerencia usuários de fornecedor"
  on public.fornecedor_usuarios
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "usuário lê o próprio vínculo de fornecedor"
  on public.fornecedor_usuarios
  for select
  to authenticated
  using (profile_id = (select auth.uid()) and (select public.papel_atual()) is not null);

-- empreendimentos
create policy "staff gerencia empreendimentos"
  on public.empreendimentos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "cliente lê o próprio empreendimento"
  on public.empreendimentos
  for select
  to authenticated
  using (public.cliente_do_empreendimento(id));

-- empreendimento_clientes
create policy "staff gerencia clientes de empreendimento"
  on public.empreendimento_clientes
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "cliente lê o próprio vínculo de empreendimento"
  on public.empreendimento_clientes
  for select
  to authenticated
  using (profile_id = (select auth.uid()) and (select public.papel_atual()) is not null);

-- modelos (só staff)
create policy "staff gerencia modelos de etapas"
  on public.modelos_etapas
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff gerencia itens de modelo"
  on public.modelo_etapas_itens
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff gerencia categorias de modelo"
  on public.modelo_categorias_documento
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- projetos e o que pende deles (a leitura das filhas herda a da tabela projetos)
create policy "staff gerencia projetos"
  on public.projetos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "quem vê o empreendimento lê os projetos"
  on public.projetos
  for select
  to authenticated
  using (public.pode_ver_empreendimento(empreendimento_id));

create policy "staff gerencia etapas de projeto"
  on public.projeto_etapas
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "quem vê o projeto lê as etapas"
  on public.projeto_etapas
  for select
  to authenticated
  using (exists (select 1 from public.projetos p where p.id = projeto_id));

create policy "staff gerencia categorias de projeto"
  on public.projeto_categorias_documento
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "quem vê o projeto lê as categorias"
  on public.projeto_categorias_documento
  for select
  to authenticated
  using (exists (select 1 from public.projetos p where p.id = projeto_id));

-- atualizacoes (cliente só vê as publicadas)
create policy "staff gerencia atualizações"
  on public.atualizacoes
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "cliente lê atualizações publicadas"
  on public.atualizacoes
  for select
  to authenticated
  using (publicado and public.cliente_do_empreendimento(empreendimento_id));

create policy "staff gerencia fotos de atualização"
  on public.atualizacao_fotos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "quem vê a atualização lê as fotos"
  on public.atualizacao_fotos
  for select
  to authenticated
  using (exists (select 1 from public.atualizacoes a where a.id = atualizacao_id));

-- obras
create policy "staff gerencia obras"
  on public.obras
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "cliente e empreiteiro leem a obra"
  on public.obras
  for select
  to authenticated
  using (
    public.cliente_do_empreendimento(empreendimento_id)
    or public.empreiteiro_da_obra(id)
  );

-- obra_empreiteiros
create policy "staff gerencia empreiteiros de obra"
  on public.obra_empreiteiros
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "empreiteiro lê o próprio vínculo de obra"
  on public.obra_empreiteiros
  for select
  to authenticated
  using (profile_id = (select auth.uid()) and (select public.papel_atual()) is not null);

-- relatos_obra: staff gerencia (inclui revisar); o autor lê os seus; o cliente
-- lê só os aprovados; o empreiteiro da obra só insere, como pendente, sem
-- campos de revisão e sem mexer em criado_em/atualizado_em (não dá para
-- retroagir a data do relato).
create policy "staff gerencia relatos de obra"
  on public.relatos_obra
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "autor lê os próprios relatos"
  on public.relatos_obra
  for select
  to authenticated
  using (autor_id = (select auth.uid()) and (select public.papel_atual()) is not null);

create policy "cliente lê relatos aprovados"
  on public.relatos_obra
  for select
  to authenticated
  using (
    status = 'aprovado'
    and exists (
      select 1
      from public.obras o
      where o.id = obra_id
        and public.cliente_do_empreendimento(o.empreendimento_id)
    )
  );

create policy "empreiteiro registra relato pendente"
  on public.relatos_obra
  for insert
  to authenticated
  with check (
    public.empreiteiro_da_obra(obra_id)
    and autor_id = (select auth.uid())
    and status = 'pendente'
    and motivo_devolucao is null
    and revisado_por is null
    and revisado_em is null
    and criado_em = now()
    and atualizado_em = now()
  );

-- relato_fotos: a leitura herda a do relato; só o autor anexa, enquanto o
-- relato está pendente, e só em caminho do próprio relato.
create policy "quem vê o relato lê as fotos"
  on public.relato_fotos
  for select
  to authenticated
  using (exists (select 1 from public.relatos_obra r where r.id = relato_id));

create policy "staff anexa fotos ao relato"
  on public.relato_fotos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff apaga fotos do relato"
  on public.relato_fotos
  for delete
  to authenticated
  using ((select public.e_staff()));

create policy "autor anexa fotos ao relato pendente"
  on public.relato_fotos
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.relatos_obra r
      where r.id = relato_id
        and r.autor_id = (select auth.uid())
        and r.status = 'pendente'
        and public.empreiteiro_da_obra(r.obra_id)
        and starts_with(storage_path, 'relatos/' || r.obra_id::text || '/' || r.id::text || '/')
    )
  );

-- Seed dos modelos (estrutura; a ABA cadastra as etapas de cada um).
insert into public.modelos_etapas (nome)
values
  ('SAA'),
  ('SES'),
  ('PER'),
  ('PEC'),
  ('Termo de Acordo'),
  ('Ordem de Serviço'),
  ('Doação de Bens')
on conflict (nome) do nothing;

insert into public.modelo_categorias_documento (modelo_id, nome, ordem)
select m.id, c.nome, c.ordem
from (
  values
    ('SAA', 'Contratos', 1),
    ('SAA', 'Projetos', 2),
    ('SAA', 'Laudos', 3),
    ('SAA', 'Outros', 4),
    ('SES', 'Contratos', 1),
    ('SES', 'Projetos', 2),
    ('SES', 'Laudos', 3),
    ('SES', 'Outros', 4),
    ('PER', 'Contratos', 1),
    ('PER', 'Projetos', 2),
    ('PER', 'Laudos', 3),
    ('PER', 'Outros', 4),
    ('PEC', 'Contratos', 1),
    ('PEC', 'Projetos', 2),
    ('PEC', 'Laudos', 3),
    ('PEC', 'Outros', 4),
    ('Termo de Acordo', 'Documentos', 1),
    ('Termo de Acordo', 'Solicitação', 2),
    ('Ordem de Serviço', 'Documentos', 1),
    ('Ordem de Serviço', 'Laudos', 2),
    ('Ordem de Serviço', 'SIMOS', 3),
    ('Doação de Bens', 'Documentos', 1)
) as c (modelo, nome, ordem)
join public.modelos_etapas m on m.nome = c.modelo
on conflict (modelo_id, nome) do nothing;

-- Cria o projeto copiando etapas e categorias do modelo. Security invoker: o
-- RLS decide, então só staff consegue; o teste explícito dá uma mensagem clara.
create function public.criar_projeto_de_modelo(
  p_empreendimento uuid,
  p_modelo uuid,
  p_nome text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_projeto uuid;
  v_primeira_etapa uuid;
begin
  if not public.e_staff() then
    raise exception 'Apenas a equipe pode criar projetos.' using errcode = 'insufficient_privilege';
  end if;

  if p_modelo is null then
    raise exception 'O modelo do projeto é obrigatório.' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.projetos (empreendimento_id, modelo_origem_id, nome)
  values (p_empreendimento, p_modelo, p_nome)
  returning id into v_projeto;

  insert into public.projeto_etapas (projeto_id, nome, ordem)
  select v_projeto, i.nome, i.ordem
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
$$;

revoke execute on function public.criar_projeto_de_modelo(uuid, uuid, text) from public, anon;
grant execute on function public.criar_projeto_de_modelo(uuid, uuid, text) to authenticated;

-- Storage: bucket privado "obras".
-- Caminhos: relatos/<obra_id>/<relato_id>/<arquivo> e
-- atualizacoes/<empreendimento_id>/<atualizacao_id>/<arquivo>. Os ids do
-- caminho são comparados como texto (id::text = pasta), sem cast que quebre
-- com lixo no nome do arquivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'obras',
  'obras',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "obras: leitura"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'obras'
    and (
      (select public.e_staff())
      or (
        array_length(storage.foldername(name), 1) = 3
        and (storage.foldername(name))[1] = 'relatos'
        and exists (
          select 1
          from public.relatos_obra r
          where r.id::text = (storage.foldername(name))[3]
            and r.obra_id::text = (storage.foldername(name))[2]
            and (
              (r.autor_id = (select auth.uid()) and (select public.papel_atual()) is not null)
              or (
                r.status = 'aprovado'
                and exists (
                  select 1
                  from public.obras o
                  where o.id = r.obra_id
                    and public.cliente_do_empreendimento(o.empreendimento_id)
                )
              )
            )
        )
      )
      or (
        array_length(storage.foldername(name), 1) = 3
        and (storage.foldername(name))[1] = 'atualizacoes'
        and exists (
          select 1
          from public.atualizacoes a
          where a.id::text = (storage.foldername(name))[3]
            and a.empreendimento_id::text = (storage.foldername(name))[2]
            and a.publicado
            and public.cliente_do_empreendimento(a.empreendimento_id)
        )
      )
    )
  );

create policy "obras: staff ou autor do relato pendente envia"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'obras'
    and (
      (select public.e_staff())
      or (
        array_length(storage.foldername(name), 1) = 3
        and (storage.foldername(name))[1] = 'relatos'
        and exists (
          select 1
          from public.relatos_obra r
          where r.id::text = (storage.foldername(name))[3]
            and r.obra_id::text = (storage.foldername(name))[2]
            and r.autor_id = (select auth.uid())
            and r.status = 'pendente'
            and public.empreiteiro_da_obra(r.obra_id)
        )
      )
    )
  );

create policy "obras: staff atualiza"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'obras' and (select public.e_staff()))
  with check (bucket_id = 'obras' and (select public.e_staff()));

create policy "obras: staff apaga"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'obras' and (select public.e_staff()));
