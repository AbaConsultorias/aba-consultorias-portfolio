-- Etapa 2, parte A — site público: configurações, serviços, portfólio,
-- loteamentos/lotes, mídias, depoimentos, contatos e o bucket site-publico.
-- Contrato: docs/ETAPA-2-CONTRATO.md (seção "A").
-- Leitura anônima só do que está publicado (ou da linha única de configuração);
-- escrita só da equipe (public.e_staff()). Toda tabela ativa RLS nesta migration.

create type public.portfolio_categoria as enum (
  'loteamento',
  'residencial',
  'obra_copasa',
  'outro'
);

create type public.lote_status as enum (
  'disponivel',
  'vendido',
  'area_tecnica'
);

create type public.midia_tipo as enum (
  'foto',
  'video'
);

-- Configurações do site: uma linha só (unico é sempre true e é unique).
create table public.configuracoes_site (
  id uuid primary key default gen_random_uuid(),
  unico boolean not null default true unique check (unico),
  whatsapp text,
  email text,
  telefone text,
  endereco text,
  mapa_url text,
  instagram_url text,
  facebook_url text,
  linkedin_url text,
  sobre_titulo text,
  sobre_texto text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  slug text not null unique,
  resumo text,
  conteudo text,
  icone text,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.portfolio_projetos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  slug text not null unique,
  cidade text,
  categoria public.portfolio_categoria not null default 'outro',
  descricao text,
  capa_path text,
  concluido_em date,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.loteamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  cidade text,
  endereco text,
  maps_url text,
  descricao text,
  banner_path text,
  banner_mobile_path text,
  mapa_svg_path text,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.lotes (
  id uuid primary key default gen_random_uuid(),
  loteamento_id uuid not null references public.loteamentos (id) on delete cascade,
  svg_id text,
  quadra text not null,
  numero text not null,
  area_m2 numeric(12, 2) check (area_m2 > 0),
  status public.lote_status not null default 'disponivel',
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (loteamento_id, quadra, numero),
  unique (loteamento_id, svg_id)
);

create table public.midias (
  id uuid primary key default gen_random_uuid(),
  tipo public.midia_tipo not null,
  storage_path text not null,
  legenda text,
  ordem int not null default 0,
  portfolio_projeto_id uuid references public.portfolio_projetos (id) on delete cascade,
  loteamento_id uuid references public.loteamentos (id) on delete cascade,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (num_nonnulls(portfolio_projeto_id, loteamento_id) = 1)
);

create index midias_portfolio_projeto_id_idx on public.midias (portfolio_projeto_id)
  where portfolio_projeto_id is not null;
create index midias_loteamento_id_idx on public.midias (loteamento_id)
  where loteamento_id is not null;

create table public.depoimentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text,
  texto text not null,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Mensagens do formulário do site. A rota insere com o client admin depois do
-- rate limit: anon/authenticated não têm insert.
create table public.contatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  email text,
  mensagem text not null,
  origem text,
  loteamento_id uuid references public.loteamentos (id) on delete set null,
  lote_id uuid references public.lotes (id) on delete set null,
  ip_hash text,
  lido boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index contatos_loteamento_id_idx on public.contatos (loteamento_id)
  where loteamento_id is not null;
create index contatos_lote_id_idx on public.contatos (lote_id)
  where lote_id is not null;
create index contatos_lido_criado_em_idx on public.contatos (lido, criado_em desc);

-- atualizado_em em todas; auditoria só onde o contrato marca [aud].
create trigger configuracoes_site_definir_atualizado_em
  before update on public.configuracoes_site
  for each row execute function public.definir_atualizado_em();

create trigger servicos_definir_atualizado_em
  before update on public.servicos
  for each row execute function public.definir_atualizado_em();

create trigger portfolio_projetos_definir_atualizado_em
  before update on public.portfolio_projetos
  for each row execute function public.definir_atualizado_em();

create trigger loteamentos_definir_atualizado_em
  before update on public.loteamentos
  for each row execute function public.definir_atualizado_em();

create trigger lotes_definir_atualizado_em
  before update on public.lotes
  for each row execute function public.definir_atualizado_em();

create trigger midias_definir_atualizado_em
  before update on public.midias
  for each row execute function public.definir_atualizado_em();

create trigger depoimentos_definir_atualizado_em
  before update on public.depoimentos
  for each row execute function public.definir_atualizado_em();

create trigger contatos_definir_atualizado_em
  before update on public.contatos
  for each row execute function public.definir_atualizado_em();

create trigger configuracoes_site_registrar_auditoria
  after insert or update or delete on public.configuracoes_site
  for each row execute function public.registrar_auditoria();

create trigger loteamentos_registrar_auditoria
  after insert or update or delete on public.loteamentos
  for each row execute function public.registrar_auditoria();

create trigger lotes_registrar_auditoria
  after insert or update or delete on public.lotes
  for each row execute function public.registrar_auditoria();

-- A linha única de configuração. Ninguém da aplicação tem insert/delete nesta
-- tabela (só update), então ela nunca é recriada nem apagada.
insert into public.configuracoes_site (unico) values (true);

alter table public.configuracoes_site enable row level security;
alter table public.servicos enable row level security;
alter table public.portfolio_projetos enable row level security;
alter table public.loteamentos enable row level security;
alter table public.lotes enable row level security;
alter table public.midias enable row level security;
alter table public.depoimentos enable row level security;
alter table public.contatos enable row level security;

-- Privilégios: conteúdo público é só select para anon; a escrita da equipe
-- passa pelo RLS. contatos não é público.
revoke all on table public.configuracoes_site from anon;
revoke all on table public.configuracoes_site from authenticated;
grant select on table public.configuracoes_site to anon;
grant select, update on table public.configuracoes_site to authenticated;

revoke all on table public.servicos from anon;
revoke all on table public.servicos from authenticated;
grant select on table public.servicos to anon;
grant select, insert, update, delete on table public.servicos to authenticated;

revoke all on table public.portfolio_projetos from anon;
revoke all on table public.portfolio_projetos from authenticated;
grant select on table public.portfolio_projetos to anon;
grant select, insert, update, delete on table public.portfolio_projetos to authenticated;

revoke all on table public.loteamentos from anon;
revoke all on table public.loteamentos from authenticated;
grant select on table public.loteamentos to anon;
grant select, insert, update, delete on table public.loteamentos to authenticated;

revoke all on table public.lotes from anon;
revoke all on table public.lotes from authenticated;
grant select on table public.lotes to anon;
grant select, insert, update, delete on table public.lotes to authenticated;

revoke all on table public.midias from anon;
revoke all on table public.midias from authenticated;
grant select on table public.midias to anon;
grant select, insert, update, delete on table public.midias to authenticated;

revoke all on table public.depoimentos from anon;
revoke all on table public.depoimentos from authenticated;
grant select on table public.depoimentos to anon;
grant select, insert, update, delete on table public.depoimentos to authenticated;

-- Staff só marca como lido: o resto da mensagem não é editável.
revoke all on table public.contatos from anon;
revoke all on table public.contatos from authenticated;
grant select, delete on table public.contatos to authenticated;
grant update (lido) on table public.contatos to authenticated;

-- configuracoes_site
create policy "leitura pública das configurações do site"
  on public.configuracoes_site
  for select
  to anon, authenticated
  using (true);

create policy "staff atualiza as configurações do site"
  on public.configuracoes_site
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- servicos
create policy "leitura pública de serviços publicados"
  on public.servicos
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia serviços"
  on public.servicos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- portfolio_projetos
create policy "leitura pública de projetos publicados"
  on public.portfolio_projetos
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia projetos do portfólio"
  on public.portfolio_projetos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- loteamentos
create policy "leitura pública de loteamentos publicados"
  on public.loteamentos
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia loteamentos"
  on public.loteamentos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- lotes: públicos só enquanto o loteamento estiver publicado.
create policy "leitura pública de lotes de loteamentos publicados"
  on public.lotes
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.loteamentos l
      where l.id = lotes.loteamento_id
        and l.publicado
    )
  );

create policy "staff gerencia lotes"
  on public.lotes
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- midias: públicas só enquanto o dono (projeto ou loteamento) estiver publicado.
create policy "leitura pública de mídias de donos publicados"
  on public.midias
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.portfolio_projetos p
      where p.id = midias.portfolio_projeto_id
        and p.publicado
    )
    or exists (
      select 1
      from public.loteamentos l
      where l.id = midias.loteamento_id
        and l.publicado
    )
  );

create policy "staff gerencia mídias"
  on public.midias
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- depoimentos
create policy "leitura pública de depoimentos publicados"
  on public.depoimentos
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia depoimentos"
  on public.depoimentos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- contatos: sem insert para ninguém da aplicação; staff lê e marca como lido;
-- só admin apaga.
create policy "staff lê contatos"
  on public.contatos
  for select
  to authenticated
  using ((select public.e_staff()));

create policy "staff marca contatos como lidos"
  on public.contatos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "admin apaga contatos"
  on public.contatos
  for delete
  to authenticated
  using ((select public.e_admin()));

-- Bucket público do site. A leitura dos arquivos é pública pelo próprio bucket;
-- as políticas abaixo só liberam a escrita (e a leitura via API) para a equipe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-publico',
  'site-publico',
  true,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/svg+xml',
    'video/mp4',
    'video/webm'
  ]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Sem select para anon: o bucket público serve o arquivo pela URL, mas não
-- deixa listar. A equipe precisa de select para update/delete/upsert via API.
create policy "staff lê arquivos do site-publico"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'site-publico' and (select public.e_staff()));

create policy "staff envia arquivos para o site-publico"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'site-publico' and (select public.e_staff()));

create policy "staff atualiza arquivos do site-publico"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'site-publico' and (select public.e_staff()))
  with check (bucket_id = 'site-publico' and (select public.e_staff()));

create policy "staff apaga arquivos do site-publico"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'site-publico' and (select public.e_staff()));
