-- Etapa 3 — conteúdo público editável: novas colunas em servicos, depoimentos,
-- loteamentos e configuracoes_site; novas tabelas parceiros, banners_hero e
-- videos_instagram; e checagem de caminho em todo *_path do bucket site-publico.
-- Contrato: docs/ETAPA-3-CONTRATO.md (seção 1).
-- Mesmo padrão da Etapa 2: anon/authenticated leem só o que está publicado;
-- escrita só da equipe (public.e_staff()).
-- Todo caminho segue <prefixo>/... e nunca contém ".." nem "//". As tabelas de
-- conteúdo ainda estão vazias, então as constraints entram direto.

-- servicos
alter table public.servicos
  add column frente text not null default 'loteadores'
    constraint servicos_frente_check check (frente in ('loteadores', 'casa')),
  add column subtitulo text,
  add column itens text[] not null default '{}',
  add column foto_path text,
  add column mensagem_whatsapp text;

alter table public.servicos
  add constraint servicos_foto_path_caminho_check check (
    foto_path is null
    or (
      starts_with(foto_path, 'servicos/')
      and length(foto_path) > length('servicos/')
      and position('..' in foto_path) = 0
      and position('//' in foto_path) = 0
    )
  );

-- depoimentos
alter table public.depoimentos
  add column origem text not null default 'cliente'
    constraint depoimentos_origem_check check (origem in ('google', 'cliente')),
  add column nota smallint
    constraint depoimentos_nota_check check (nota between 1 and 5),
  add column quando text;

-- loteamentos
alter table public.loteamentos
  add column capa_path text;

alter table public.loteamentos
  add constraint loteamentos_capa_path_caminho_check check (
    capa_path is null
    or (
      starts_with(capa_path, 'loteamentos/' || id::text || '/')
      and length(capa_path) > length('loteamentos/' || id::text || '/')
      and position('..' in capa_path) = 0
      and position('//' in capa_path) = 0
    )
  ),
  add constraint loteamentos_banner_path_caminho_check check (
    banner_path is null
    or (
      starts_with(banner_path, 'loteamentos/' || id::text || '/')
      and length(banner_path) > length('loteamentos/' || id::text || '/')
      and position('..' in banner_path) = 0
      and position('//' in banner_path) = 0
    )
  ),
  add constraint loteamentos_banner_mobile_path_caminho_check check (
    banner_mobile_path is null
    or (
      starts_with(banner_mobile_path, 'loteamentos/' || id::text || '/')
      and length(banner_mobile_path) > length('loteamentos/' || id::text || '/')
      and position('..' in banner_mobile_path) = 0
      and position('//' in banner_mobile_path) = 0
    )
  ),
  add constraint loteamentos_mapa_svg_path_caminho_check check (
    mapa_svg_path is null
    or (
      starts_with(mapa_svg_path, 'loteamentos/' || id::text || '/')
      and length(mapa_svg_path) > length('loteamentos/' || id::text || '/')
      and position('..' in mapa_svg_path) = 0
      and position('//' in mapa_svg_path) = 0
    )
  );

-- portfolio_projetos
alter table public.portfolio_projetos
  add constraint portfolio_projetos_capa_path_caminho_check check (
    capa_path is null
    or (
      starts_with(capa_path, 'portfolio/' || id::text || '/')
      and length(capa_path) > length('portfolio/' || id::text || '/')
      and position('..' in capa_path) = 0
      and position('//' in capa_path) = 0
    )
  );

-- midias: o caminho fica na pasta do dono (loteamento ou projeto do portfólio).
alter table public.midias
  add constraint midias_storage_path_caminho_check check (
    position('..' in storage_path) = 0
    and position('//' in storage_path) = 0
    and (
      (
        loteamento_id is not null
        and starts_with(storage_path, 'loteamentos/' || loteamento_id::text || '/')
        and length(storage_path) > length('loteamentos/' || loteamento_id::text || '/')
      )
      or (
        portfolio_projeto_id is not null
        and starts_with(storage_path, 'portfolio/' || portfolio_projeto_id::text || '/')
        and length(storage_path) > length('portfolio/' || portfolio_projeto_id::text || '/')
      )
    )
  );

-- configuracoes_site: a política de leitura da Etapa 2 já libera a linha única
-- para anon e authenticated; as colunas novas entram sem mudar privilégios.
alter table public.configuracoes_site
  add column google_avaliacoes_url text,
  add column google_avaliar_url text,
  add column google_nota numeric(2, 1),
  add column google_total int,
  add column instagram_usuario text;

-- Parceiros (logos da faixa da home)
create table public.parceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_path text not null
    constraint parceiros_logo_path_caminho_check check (
      starts_with(logo_path, 'parceiros/')
      and length(logo_path) > length('parceiros/')
      and position('..' in logo_path) = 0
      and position('//' in logo_path) = 0
    ),
  site_url text,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Banners do topo da home (um por tema)
create table public.banners_hero (
  id uuid primary key default gen_random_uuid(),
  sobrancelha text not null,
  titulo text not null,
  titulo_destaque text,
  texto text not null,
  mensagem_whatsapp text,
  botao_rotulo text,
  botao_href text,
  imagem_path text not null
    constraint banners_hero_imagem_path_caminho_check check (
      starts_with(imagem_path, 'hero/')
      and length(imagem_path) > length('hero/')
      and position('..' in imagem_path) = 0
      and position('//' in imagem_path) = 0
    ),
  imagem_posicao text not null default 'center',
  legenda text,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Vídeos do Instagram exibidos na home
create table public.videos_instagram (
  id uuid primary key default gen_random_uuid(),
  video_path text not null
    constraint videos_instagram_video_path_caminho_check check (
      starts_with(video_path, 'instagram/')
      and length(video_path) > length('instagram/')
      and position('..' in video_path) = 0
      and position('//' in video_path) = 0
    ),
  poster_path text
    constraint videos_instagram_poster_path_caminho_check check (
      poster_path is null
      or (
        starts_with(poster_path, 'instagram/')
        and length(poster_path) > length('instagram/')
        and position('..' in poster_path) = 0
        and position('//' in poster_path) = 0
      )
    ),
  legenda text,
  ordem int not null default 0,
  publicado boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger parceiros_definir_atualizado_em
  before update on public.parceiros
  for each row execute function public.definir_atualizado_em();

create trigger banners_hero_definir_atualizado_em
  before update on public.banners_hero
  for each row execute function public.definir_atualizado_em();

create trigger videos_instagram_definir_atualizado_em
  before update on public.videos_instagram
  for each row execute function public.definir_atualizado_em();

create trigger parceiros_registrar_auditoria
  after insert or update or delete on public.parceiros
  for each row execute function public.registrar_auditoria();

create trigger banners_hero_registrar_auditoria
  after insert or update or delete on public.banners_hero
  for each row execute function public.registrar_auditoria();

create trigger videos_instagram_registrar_auditoria
  after insert or update or delete on public.videos_instagram
  for each row execute function public.registrar_auditoria();

alter table public.parceiros enable row level security;
alter table public.banners_hero enable row level security;
alter table public.videos_instagram enable row level security;

revoke all on table public.parceiros from anon;
revoke all on table public.parceiros from authenticated;
grant select on table public.parceiros to anon;
grant select, insert, update, delete on table public.parceiros to authenticated;

revoke all on table public.banners_hero from anon;
revoke all on table public.banners_hero from authenticated;
grant select on table public.banners_hero to anon;
grant select, insert, update, delete on table public.banners_hero to authenticated;

revoke all on table public.videos_instagram from anon;
revoke all on table public.videos_instagram from authenticated;
grant select on table public.videos_instagram to anon;
grant select, insert, update, delete on table public.videos_instagram to authenticated;

create policy "leitura pública de parceiros publicados"
  on public.parceiros
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia parceiros"
  on public.parceiros
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "leitura pública de banners do topo publicados"
  on public.banners_hero
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia banners do topo"
  on public.banners_hero
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "leitura pública de vídeos do instagram publicados"
  on public.videos_instagram
  for select
  to anon, authenticated
  using (publicado);

create policy "staff gerencia vídeos do instagram"
  on public.videos_instagram
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));
