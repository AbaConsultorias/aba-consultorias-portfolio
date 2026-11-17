-- Etapa 2 — correções de segurança depois da revisão das migrations A, B e C.
-- Contrato: docs/ETAPA-2-CONTRATO.md. As migrations anteriores já estão aplicadas
-- e não são editadas: tudo aqui é drop/alter/create por cima delas.
--
-- 1. Buckets privados (obras, documentos, fornecedores): só a equipe tem política
--    em storage.objects. Download (URL assinada de 60 s) e upload passam por rota
--    de servidor, que confere a linha da tabela com a sessão do usuário (RLS) e só
--    então usa a secret key.
-- 2. fornecedor_documentos e relato_fotos: o fornecedor/empreiteiro não insere mais
--    direto; a rota de servidor insere com o client admin.
-- 3. usuario_do_fornecedor exige fornecedor ativo; o autor do relato precisa
--    continuar vinculado à obra para ler os próprios relatos.
-- 4. Caminho de arquivo amarrado ao dono da linha e sem '..' nem '//'.
-- 5. Carimbo de liberação e de revisão feito por trigger (o cliente não forja).

-- ---------------------------------------------------------------------------
-- 1. Storage: nenhuma política para quem não é equipe nos buckets privados.
-- ---------------------------------------------------------------------------

drop policy "obras: leitura" on storage.objects;
drop policy "obras: staff ou autor do relato pendente envia" on storage.objects;
drop policy "documentos: cliente lê arquivo liberado do seu empreendimento" on storage.objects;
drop policy "fornecedores: usuário do fornecedor lê a própria pasta" on storage.objects;
drop policy "fornecedores: usuário do fornecedor envia para a própria pasta de documentos" on storage.objects;

create policy "obras: staff lê"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'obras' and (select public.e_staff()));

create policy "obras: staff envia"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'obras' and (select public.e_staff()));

-- Sobram, nos três buckets privados, só as políticas de equipe que já existiam:
-- "obras: staff atualiza/apaga", "documentos: staff lê/envia/atualiza/apaga" e
-- "fornecedores: staff lê/envia/atualiza/apaga". Se alguma política criada fora das
-- migrations deixar outro papel entrar, a migration falha em vez de passar calada.
do $$
declare
  v_politica text;
begin
  select p.policyname
  into v_politica
  from pg_policies p
  cross join lateral (select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as texto) t
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and t.texto ~ '''(obras|documentos|fornecedores)'''
    and (
      t.texto !~ 'e_staff'
      or t.texto ~ '(cliente_do_empreendimento|empreiteiro_da_obra|usuario_do_fornecedor|auth\.uid)'
    )
  limit 1;

  if v_politica is not null then
    raise exception 'Política "%" em storage.objects dá acesso a bucket privado a quem não é equipe.', v_politica;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Inserts que passam a ser só da rota de servidor (client admin).
-- ---------------------------------------------------------------------------

drop policy "usuário do fornecedor envia documento pendente" on public.fornecedor_documentos;
drop policy "autor anexa fotos ao relato pendente" on public.relato_fotos;

-- ---------------------------------------------------------------------------
-- 3. Acesso: fornecedor ativo e autor ainda vinculado à obra.
-- ---------------------------------------------------------------------------

create or replace function public.usuario_do_fornecedor(p_fornecedor uuid)
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
      join public.fornecedores f on f.id = fu.fornecedor_id
      where fu.fornecedor_id = p_fornecedor
        and fu.profile_id = (select auth.uid())
        and f.ativo
    )
$$;

revoke execute on function public.usuario_do_fornecedor(uuid) from public, anon;
grant execute on function public.usuario_do_fornecedor(uuid) to authenticated;

-- A leitura das fotos do relato (relato_fotos) herda esta política.
alter policy "autor lê os próprios relatos"
  on public.relatos_obra
  using (autor_id = (select auth.uid()) and public.empreiteiro_da_obra(obra_id));

-- ---------------------------------------------------------------------------
-- 4. Caminhos de arquivo amarrados ao dono e sem travessia.
-- ---------------------------------------------------------------------------

alter table public.documentos
  add constraint documentos_storage_path_dono_check
  check (starts_with(storage_path, empreendimento_id::text || '/'));

alter table public.fornecedor_contratos
  add constraint fornecedor_contratos_storage_path_dono_check
  check (starts_with(storage_path, fornecedor_id::text || '/contratos/'));

alter table public.fornecedor_documentos
  add constraint fornecedor_documentos_storage_path_dono_check
  check (starts_with(storage_path, fornecedor_id::text || '/documentos/'));

alter table public.documentos
  add constraint documentos_storage_path_seguro_check
  check (position('..' in storage_path) = 0 and position('//' in storage_path) = 0);

alter table public.fornecedor_contratos
  add constraint fornecedor_contratos_storage_path_seguro_check
  check (position('..' in storage_path) = 0 and position('//' in storage_path) = 0);

alter table public.fornecedor_documentos
  add constraint fornecedor_documentos_storage_path_seguro_check
  check (position('..' in storage_path) = 0 and position('//' in storage_path) = 0);

alter table public.atualizacao_fotos
  add constraint atualizacao_fotos_storage_path_seguro_check
  check (position('..' in storage_path) = 0 and position('//' in storage_path) = 0);

alter table public.relato_fotos
  add constraint relato_fotos_storage_path_seguro_check
  check (position('..' in storage_path) = 0 and position('//' in storage_path) = 0);

alter table public.midias
  add constraint midias_storage_path_seguro_check
  check (position('..' in storage_path) = 0 and position('//' in storage_path) = 0);

-- O dono do caminho de foto está na tabela pai, então a checagem é por trigger.
-- Security definer: confere o pai mesmo quando quem escreve não o enxerga, para o
-- erro não depender da visibilidade de quem chama (o RLS decide quem pode inserir).
create function public.validar_caminho_foto_atualizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.atualizacoes a
    where a.id = new.atualizacao_id
      and starts_with(
        new.storage_path,
        'atualizacoes/' || a.empreendimento_id::text || '/' || a.id::text || '/'
      )
  ) then
    raise exception 'O caminho da foto não pertence a esta atualização.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create function public.validar_caminho_foto_relato()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.relatos_obra r
    where r.id = new.relato_id
      and starts_with(
        new.storage_path,
        'relatos/' || r.obra_id::text || '/' || r.id::text || '/'
      )
  ) then
    raise exception 'O caminho da foto não pertence a este relato.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_caminho_foto_atualizacao() from public, anon, authenticated;
revoke execute on function public.validar_caminho_foto_relato() from public, anon, authenticated;

create trigger atualizacao_fotos_validar_caminho
  before insert or update on public.atualizacao_fotos
  for each row execute function public.validar_caminho_foto_atualizacao();

create trigger relato_fotos_validar_caminho
  before insert or update on public.relato_fotos
  for each row execute function public.validar_caminho_foto_relato();

-- ---------------------------------------------------------------------------
-- 5. Carimbos de liberação e de revisão (BEFORE UPDATE, security invoker).
-- ---------------------------------------------------------------------------

-- Quem libera/revisa e quando vem de auth.uid() e now(), nunca do que o cliente
-- mandou. Sem mudança em liberado_cliente/status, os valores antigos são mantidos.
create function public.carimbar_liberacao_documento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.liberado_cliente is distinct from old.liberado_cliente then
    if new.liberado_cliente then
      new.liberado_por = (select auth.uid());
      new.liberado_em = now();
    else
      new.liberado_por = null;
      new.liberado_em = null;
    end if;
  else
    new.liberado_por = old.liberado_por;
    new.liberado_em = old.liberado_em;
  end if;

  return new;
end;
$$;

-- Serve relatos_obra e fornecedor_documentos: as duas têm status, revisado_por e
-- revisado_em.
create function public.carimbar_revisao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.revisado_por = (select auth.uid());
    new.revisado_em = now();
  else
    new.revisado_por = old.revisado_por;
    new.revisado_em = old.revisado_em;
  end if;

  return new;
end;
$$;

revoke execute on function public.carimbar_liberacao_documento() from public, anon, authenticated;
revoke execute on function public.carimbar_revisao() from public, anon, authenticated;

create trigger documentos_carimbar_liberacao
  before update on public.documentos
  for each row execute function public.carimbar_liberacao_documento();

create trigger relatos_obra_carimbar_revisao
  before update on public.relatos_obra
  for each row execute function public.carimbar_revisao();

create trigger fornecedor_documentos_carimbar_revisao
  before update on public.fornecedor_documentos
  for each row execute function public.carimbar_revisao();
