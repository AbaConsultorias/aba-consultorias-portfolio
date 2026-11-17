-- Etapa 2, parte C — documentos e financeiro.
-- Contrato: docs/ETAPA-2-CONTRATO.md (seção "C").
-- Depende das migrations A (site público) e B (operação): empreendimentos,
-- projetos, projeto_categorias_documento, fornecedores, fornecedor_usuarios,
-- obras, obra_empreiteiros e as funções cliente_do_empreendimento,
-- empreiteiro_da_obra e usuario_do_fornecedor.
-- Toda tabela ativa RLS nesta mesma migration. Nenhuma é acessível ao anon.

create type public.documento_fornecedor_status as enum (
  'pendente',
  'aprovado',
  'recusado'
);

-- Documentos de um empreendimento. O cliente só enxerga o que a equipe liberou,
-- e só PDF pode ser liberado (zip/rar/imagens são de uso interno).
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete restrict,
  projeto_id uuid references public.projetos (id) on delete set null,
  categoria_id uuid references public.projeto_categorias_documento (id) on delete set null,
  titulo text not null,
  storage_path text not null unique,
  mime text not null,
  tamanho bigint not null check (tamanho > 0),
  sha256 text,
  liberado_cliente boolean not null default false,
  liberado_por uuid references public.profiles (id) on delete set null,
  liberado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (not liberado_cliente or mime = 'application/pdf')
);

create index documentos_empreendimento_id_idx on public.documentos (empreendimento_id);
create index documentos_projeto_id_idx on public.documentos (projeto_id);
create index documentos_categoria_id_idx on public.documentos (categoria_id);
create index documentos_liberado_por_idx on public.documentos (liberado_por);

-- Contratos do fornecedor, anexados pela equipe.
create table public.fornecedor_contratos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores (id) on delete restrict,
  empreendimento_id uuid references public.empreendimentos (id) on delete set null,
  titulo text not null,
  storage_path text not null unique,
  mime text not null,
  tamanho bigint not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index fornecedor_contratos_fornecedor_id_idx on public.fornecedor_contratos (fornecedor_id);
create index fornecedor_contratos_empreendimento_id_idx on public.fornecedor_contratos (empreendimento_id);

-- Documentos enviados pelo fornecedor (certidões, notas...), revisados pela equipe.
create table public.fornecedor_documentos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores (id) on delete restrict,
  enviado_por uuid not null references public.profiles (id) on delete restrict default auth.uid(),
  empreendimento_id uuid references public.empreendimentos (id) on delete set null,
  tipo text not null,
  titulo text not null,
  storage_path text not null unique,
  mime text not null,
  tamanho bigint not null check (tamanho > 0),
  status public.documento_fornecedor_status not null default 'pendente',
  motivo text,
  revisado_por uuid references public.profiles (id) on delete set null,
  revisado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index fornecedor_documentos_fornecedor_id_idx on public.fornecedor_documentos (fornecedor_id);
create index fornecedor_documentos_enviado_por_idx on public.fornecedor_documentos (enviado_por);
create index fornecedor_documentos_empreendimento_id_idx on public.fornecedor_documentos (empreendimento_id);
create index fornecedor_documentos_revisado_por_idx on public.fornecedor_documentos (revisado_por);

-- Financeiro: dinheiro sempre em centavos (bigint).
create table public.itens_financeiros (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos (id) on delete restrict,
  fornecedor_id uuid references public.fornecedores (id) on delete restrict,
  descricao text not null,
  valor_contratado_centavos bigint not null check (valor_contratado_centavos >= 0),
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index itens_financeiros_empreendimento_id_idx on public.itens_financeiros (empreendimento_id);
create index itens_financeiros_fornecedor_id_idx on public.itens_financeiros (fornecedor_id);

create table public.parcelas (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.itens_financeiros (id) on delete cascade,
  vencimento date not null,
  valor_previsto_centavos bigint not null check (valor_previsto_centavos >= 0),
  data_pagamento date,
  valor_pago_centavos bigint not null default 0 check (valor_pago_centavos >= 0),
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index parcelas_item_id_idx on public.parcelas (item_id);
create index parcelas_vencimento_idx on public.parcelas (vencimento);

-- Registro de downloads: só a rota de download grava (client admin); só admin lê.
create table public.downloads_log (
  id uuid primary key default gen_random_uuid(),
  arquivo_tipo text not null check (
    arquivo_tipo in ('documento', 'fornecedor_documento', 'fornecedor_contrato', 'foto_obra')
  ),
  arquivo_id uuid not null,
  profile_id uuid references public.profiles (id) on delete set null,
  ip_hash text,
  em timestamptz not null default now()
);

create index downloads_log_profile_id_idx on public.downloads_log (profile_id);
create index downloads_log_arquivo_idx on public.downloads_log (arquivo_tipo, arquivo_id);
create index downloads_log_em_idx on public.downloads_log (em desc);

-- atualizado_em e auditoria.
create trigger documentos_definir_atualizado_em
  before update on public.documentos
  for each row execute function public.definir_atualizado_em();

create trigger fornecedor_contratos_definir_atualizado_em
  before update on public.fornecedor_contratos
  for each row execute function public.definir_atualizado_em();

create trigger fornecedor_documentos_definir_atualizado_em
  before update on public.fornecedor_documentos
  for each row execute function public.definir_atualizado_em();

create trigger itens_financeiros_definir_atualizado_em
  before update on public.itens_financeiros
  for each row execute function public.definir_atualizado_em();

create trigger parcelas_definir_atualizado_em
  before update on public.parcelas
  for each row execute function public.definir_atualizado_em();

create trigger documentos_registrar_auditoria
  after insert or update or delete on public.documentos
  for each row execute function public.registrar_auditoria();

create trigger fornecedor_contratos_registrar_auditoria
  after insert or update or delete on public.fornecedor_contratos
  for each row execute function public.registrar_auditoria();

create trigger fornecedor_documentos_registrar_auditoria
  after insert or update or delete on public.fornecedor_documentos
  for each row execute function public.registrar_auditoria();

create trigger itens_financeiros_registrar_auditoria
  after insert or update or delete on public.itens_financeiros
  for each row execute function public.registrar_auditoria();

create trigger parcelas_registrar_auditoria
  after insert or update or delete on public.parcelas
  for each row execute function public.registrar_auditoria();

-- RLS e grants. Nada para o anon; authenticated só recebe o que as políticas usam.
alter table public.documentos enable row level security;
alter table public.fornecedor_contratos enable row level security;
alter table public.fornecedor_documentos enable row level security;
alter table public.itens_financeiros enable row level security;
alter table public.parcelas enable row level security;
alter table public.downloads_log enable row level security;

revoke all on table public.documentos from anon;
revoke all on table public.fornecedor_contratos from anon;
revoke all on table public.fornecedor_documentos from anon;
revoke all on table public.itens_financeiros from anon;
revoke all on table public.parcelas from anon;
revoke all on table public.downloads_log from anon;

revoke all on table public.documentos from authenticated;
revoke all on table public.fornecedor_contratos from authenticated;
revoke all on table public.fornecedor_documentos from authenticated;
revoke all on table public.itens_financeiros from authenticated;
revoke all on table public.parcelas from authenticated;
revoke all on table public.downloads_log from authenticated;

grant select, insert, update, delete on table public.documentos to authenticated;
grant select, insert, update, delete on table public.fornecedor_contratos to authenticated;
grant select, insert, update, delete on table public.fornecedor_documentos to authenticated;
grant select, insert, update, delete on table public.itens_financeiros to authenticated;
grant select, insert, update, delete on table public.parcelas to authenticated;
grant select on table public.downloads_log to authenticated;

-- documentos
create policy "staff e clientes do empreendimento leem documentos liberados"
  on public.documentos
  for select
  to authenticated
  using (
    (select public.e_staff())
    or (liberado_cliente and public.cliente_do_empreendimento(empreendimento_id))
  );

create policy "staff insere documentos"
  on public.documentos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza documentos"
  on public.documentos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga documentos"
  on public.documentos
  for delete
  to authenticated
  using ((select public.e_staff()));

-- fornecedor_contratos
create policy "staff e usuários do fornecedor leem contratos"
  on public.fornecedor_contratos
  for select
  to authenticated
  using (
    (select public.e_staff())
    or public.usuario_do_fornecedor(fornecedor_id)
  );

create policy "staff insere contratos de fornecedor"
  on public.fornecedor_contratos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza contratos de fornecedor"
  on public.fornecedor_contratos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga contratos de fornecedor"
  on public.fornecedor_contratos
  for delete
  to authenticated
  using ((select public.e_staff()));

-- fornecedor_documentos
create policy "staff e usuários do fornecedor leem documentos do fornecedor"
  on public.fornecedor_documentos
  for select
  to authenticated
  using (
    (select public.e_staff())
    or public.usuario_do_fornecedor(fornecedor_id)
  );

create policy "staff insere documentos de fornecedor"
  on public.fornecedor_documentos
  for insert
  to authenticated
  with check ((select public.e_staff()));

-- Este with check é o guard: o fornecedor só cria linha pendente, em seu nome,
-- sem campos de revisão e com o arquivo na própria pasta de documentos.
create policy "usuário do fornecedor envia documento pendente"
  on public.fornecedor_documentos
  for insert
  to authenticated
  with check (
    public.usuario_do_fornecedor(fornecedor_id)
    and enviado_por = (select auth.uid())
    and status = 'pendente'
    and motivo is null
    and revisado_por is null
    and revisado_em is null
    and storage_path like fornecedor_id::text || '/documentos/%'
  );

create policy "staff atualiza documentos de fornecedor"
  on public.fornecedor_documentos
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "admin apaga documentos de fornecedor"
  on public.fornecedor_documentos
  for delete
  to authenticated
  using ((select public.e_admin()));

-- itens_financeiros
create policy "staff, clientes e fornecedor do item leem itens financeiros"
  on public.itens_financeiros
  for select
  to authenticated
  using (
    (select public.e_staff())
    or public.cliente_do_empreendimento(empreendimento_id)
    or (fornecedor_id is not null and public.usuario_do_fornecedor(fornecedor_id))
  );

create policy "staff insere itens financeiros"
  on public.itens_financeiros
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza itens financeiros"
  on public.itens_financeiros
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga itens financeiros"
  on public.itens_financeiros
  for delete
  to authenticated
  using ((select public.e_staff()));

-- parcelas: quem enxerga o item enxerga a parcela (o subselect passa pelo RLS
-- de itens_financeiros).
create policy "quem lê o item financeiro lê as parcelas"
  on public.parcelas
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.itens_financeiros i
      where i.id = parcelas.item_id
    )
  );

create policy "staff insere parcelas"
  on public.parcelas
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza parcelas"
  on public.parcelas
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga parcelas"
  on public.parcelas
  for delete
  to authenticated
  using ((select public.e_staff()));

-- downloads_log: só admin lê; sem política de escrita.
create policy "admin lê o log de downloads"
  on public.downloads_log
  for select
  to authenticated
  using ((select public.e_admin()));

-- View de situação das parcelas. security_invoker: respeita o RLS de parcelas.
create view public.parcelas_situacao
with (security_invoker = true)
as
select
  p.*,
  (p.data_pagamento is not null or p.valor_pago_centavos >= p.valor_previsto_centavos) as quitada,
  greatest(p.valor_previsto_centavos - p.valor_pago_centavos, 0) as saldo_centavos
from public.parcelas p;

revoke all on table public.parcelas_situacao from anon;
revoke all on table public.parcelas_situacao from authenticated;
grant select on table public.parcelas_situacao to authenticated;

-- Funções de nome: mostram só o nome, sem abrir a linha inteira. Retornam null
-- quando quem chama não tem direito (ou o registro não existe).
create function public.nome_empreendimento(p_empreendimento uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.nome
  from public.empreendimentos e
  where e.id = p_empreendimento
    and (
      public.e_staff()
      or public.cliente_do_empreendimento(e.id)
      or exists (
        select 1
        from public.obras o
        where o.empreendimento_id = e.id
          and public.empreiteiro_da_obra(o.id)
      )
      or exists (
        select 1
        from public.itens_financeiros i
        where i.empreendimento_id = e.id
          and i.fornecedor_id is not null
          and public.usuario_do_fornecedor(i.fornecedor_id)
      )
    )
$$;

create function public.nome_fornecedor(p_fornecedor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(f.nome_fantasia, f.razao_social)
  from public.fornecedores f
  where f.id = p_fornecedor
    and (
      public.e_staff()
      or public.usuario_do_fornecedor(f.id)
      or exists (
        select 1
        from public.itens_financeiros i
        where i.fornecedor_id = f.id
          and public.cliente_do_empreendimento(i.empreendimento_id)
      )
    )
$$;

create function public.nome_pessoa(p_profile uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.nome
  from public.profiles p
  where p.id = p_profile
    and (
      public.e_staff()
      or (p.id = (select auth.uid()) and public.papel_atual() is not null)
      or (
        public.papel_atual() = 'cliente'
        and exists (
          select 1
          from public.obra_empreiteiros oe
          join public.obras o on o.id = oe.obra_id
          where oe.profile_id = p.id
            and public.cliente_do_empreendimento(o.empreendimento_id)
        )
      )
    )
$$;

revoke execute on function public.nome_empreendimento(uuid) from public, anon;
revoke execute on function public.nome_fornecedor(uuid) from public, anon;
revoke execute on function public.nome_pessoa(uuid) from public, anon;
grant execute on function public.nome_empreendimento(uuid) to authenticated;
grant execute on function public.nome_fornecedor(uuid) to authenticated;
grant execute on function public.nome_pessoa(uuid) to authenticated;

-- Storage: buckets privados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'documentos',
    'documentos',
    false,
    26214400,
    array[
      'application/pdf',
      'application/zip',
      'application/x-rar-compressed',
      'image/jpeg',
      'image/png'
    ]
  ),
  (
    'fornecedores',
    'fornecedores',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Bucket documentos: caminho <empreendimento_id>/<uuid>.<ext>.
create policy "documentos: staff lê"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'documentos' and (select public.e_staff()));

create policy "documentos: cliente lê arquivo liberado do seu empreendimento"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documentos'
    and exists (
      select 1
      from public.documentos d
      where d.storage_path = objects.name
        and d.liberado_cliente
        and public.cliente_do_empreendimento(d.empreendimento_id)
    )
  );

create policy "documentos: staff envia"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'documentos' and (select public.e_staff()));

create policy "documentos: staff atualiza"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'documentos' and (select public.e_staff()))
  with check (bucket_id = 'documentos' and (select public.e_staff()));

create policy "documentos: staff apaga"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'documentos' and (select public.e_staff()));

-- Bucket fornecedores: <fornecedor_id>/documentos/<uuid>.<ext> e
-- <fornecedor_id>/contratos/<uuid>.<ext>. A pasta vem como texto e é comparada
-- como texto com o id: um caminho com lixo nunca dá erro de cast.
create policy "fornecedores: staff lê"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'fornecedores' and (select public.e_staff()));

create policy "fornecedores: usuário do fornecedor lê a própria pasta"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'fornecedores'
    and exists (
      select 1
      from public.fornecedor_usuarios fu
      where fu.fornecedor_id::text = (storage.foldername(objects.name))[1]
        and public.usuario_do_fornecedor(fu.fornecedor_id)
    )
  );

create policy "fornecedores: staff envia"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'fornecedores' and (select public.e_staff()));

create policy "fornecedores: usuário do fornecedor envia para a própria pasta de documentos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'fornecedores'
    and (storage.foldername(objects.name))[2] = 'documentos'
    and array_length(storage.foldername(objects.name), 1) = 2
    and exists (
      select 1
      from public.fornecedor_usuarios fu
      where fu.fornecedor_id::text = (storage.foldername(objects.name))[1]
        and public.usuario_do_fornecedor(fu.fornecedor_id)
    )
  );

create policy "fornecedores: staff atualiza"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'fornecedores' and (select public.e_staff()))
  with check (bucket_id = 'fornecedores' and (select public.e_staff()));

create policy "fornecedores: staff apaga"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'fornecedores' and (select public.e_staff()));
