-- Etapa 8, onda 1 — base das permissões internas: catálogo, tabela equipe_permissoes e tem_permissao().
-- Contrato: docs/ETAPA-8-CONTRATO.md §2, §3 e §6.
-- Nada que já existe passa a usar isto nesta migration: política, função e rota continuam como estão.
-- Desfazer: supabase/reversoes/20261105100000_etapa8_permissoes.down.sql (fica fora de migrations/ de propósito).
--
-- A lista do catálogo e os pré-requisitos também existem em src/lib/auth/permissoes.ts;
-- scripts/testar-permissoes-catalogo.mjs confere os dois lados.

begin;

create function public.catalogo_permissoes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'site.ver',
    'site.editar',
    'contatos.ver',
    'contatos.editar',
    'empreendimentos.ver',
    'empreendimentos.editar',
    'clientes.ver',
    'clientes.editar',
    'atualizacoes.ver',
    'atualizacoes.editar',
    'documentos.ver',
    'documentos.editar',
    'documentos.liberar',
    'financeiro.ver',
    'financeiro.editar',
    'obras.ver',
    'obras.editar',
    'obras.aprovar',
    'fornecedores.ver',
    'fornecedores.editar',
    'servidor.regras',
    'painel.servidor'
  ]::text[]
$$;

create function public.prerequisitos_permissao(p_permissao text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_permissao = 'site.editar' then array['site.ver']
    when p_permissao = 'contatos.editar' then array['contatos.ver']
    when p_permissao = 'empreendimentos.editar' then array['empreendimentos.ver']
    when p_permissao = 'clientes.editar' then array['clientes.ver']
    when p_permissao = 'atualizacoes.editar' then array['atualizacoes.ver']
    when p_permissao = 'documentos.editar' then array['documentos.ver']
    when p_permissao = 'documentos.liberar' then array['documentos.ver']
    when p_permissao = 'financeiro.editar' then array['financeiro.ver']
    when p_permissao = 'obras.editar' then array['obras.ver']
    when p_permissao = 'obras.aprovar' then array['obras.ver']
    when p_permissao = 'fornecedores.editar' then array['fornecedores.ver']
    when p_permissao = 'servidor.regras' then array['empreendimentos.ver']
    else array[]::text[]
  end
$$;

-- Uma linha por permissão concedida. A linha é imutável: conceder e remover são linhas novas.
create table public.equipe_permissoes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  permissao text not null
    constraint equipe_permissoes_permissao_catalogo check (permissao = any (public.catalogo_permissoes())),
  concedida_por uuid references public.profiles (id) on delete set null,
  concedida_em timestamptz not null default now(),
  unique (profile_id, permissao)
);

alter table public.equipe_permissoes enable row level security;

-- Tabela nova herda GRANT amplo do Supabase. Sem UPDATE para ninguém; a secret key
-- (service_role) segue o padrão das outras tabelas e é barrada pelo trigger de imutabilidade.
revoke all on table public.equipe_permissoes from public, anon, authenticated;
grant select, insert, delete on table public.equipe_permissoes to authenticated;

create policy "equipe lê as próprias permissões, admin lê todas"
  on public.equipe_permissoes
  for select
  to authenticated
  using (profile_id = (select auth.uid()) or (select public.e_admin()));

create policy "admin concede permissões"
  on public.equipe_permissoes
  for insert
  to authenticated
  with check ((select public.e_admin()));

create policy "admin remove permissões"
  on public.equipe_permissoes
  for delete
  to authenticated
  using ((select public.e_admin()));

-- Os dois triggers abaixo leem as linhas já gravadas do mesmo perfil; o lock por perfil faz duas
-- gravações simultâneas esperarem uma pela outra, senão ambas passariam pela checagem de dependência.
create function public.validar_insercao_equipe_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_faltando text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.profile_id::text, 0));

  new.concedida_por := (select auth.uid());
  new.concedida_em := now();

  if not exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.papel = 'equipe'
  ) then
    raise exception 'Só contas da equipe podem receber permissões.'
      using errcode = 'check_violation';
  end if;

  select pre.permissao into v_faltando
  from unnest(public.prerequisitos_permissao(new.permissao)) as pre(permissao)
  where not exists (
    select 1 from public.equipe_permissoes e
    where e.profile_id = new.profile_id and e.permissao = pre.permissao
  )
  limit 1;

  if found then
    raise exception 'Para conceder "%", a permissão "%" precisa ser concedida antes.', new.permissao, v_faltando
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_insercao_equipe_permissao() from public, anon, authenticated;

create function public.validar_remocao_equipe_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_dependente text;
begin
  perform pg_advisory_xact_lock(hashtextextended(old.profile_id::text, 0));

  if not exists (select 1 from public.profiles p where p.id = old.profile_id) then
    return old;
  end if;

  select e.permissao into v_dependente
  from public.equipe_permissoes e
  where e.profile_id = old.profile_id
    and e.id <> old.id
    and old.permissao = any (public.prerequisitos_permissao(e.permissao))
  limit 1;

  if found then
    raise exception 'Para remover "%", remova antes a permissão "%", que depende dela.', old.permissao, v_dependente
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

revoke execute on function public.validar_remocao_equipe_permissao() from public, anon, authenticated;

-- A única mudança aceita é a do próprio "on delete set null": o admin que concedeu deixou de existir.
create function public.bloquear_alteracao_equipe_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.concedida_por is not null
     and new.concedida_por is null
     and (new.id, new.profile_id, new.permissao, new.concedida_em)
         is not distinct from (old.id, old.profile_id, old.permissao, old.concedida_em)
     and not exists (select 1 from public.profiles p where p.id = old.concedida_por) then
    return new;
  end if;

  raise exception 'Permissão concedida não pode ser alterada: remova a linha e conceda de novo.'
    using errcode = 'check_violation';
end;
$$;

revoke execute on function public.bloquear_alteracao_equipe_permissao() from public, anon, authenticated;

create trigger equipe_permissoes_validar_insercao
  before insert on public.equipe_permissoes
  for each row execute function public.validar_insercao_equipe_permissao();

create trigger equipe_permissoes_validar_remocao
  before delete on public.equipe_permissoes
  for each row execute function public.validar_remocao_equipe_permissao();

create trigger equipe_permissoes_bloquear_alteracao
  before update on public.equipe_permissoes
  for each row execute function public.bloquear_alteracao_equipe_permissao();

create trigger equipe_permissoes_registrar_auditoria
  after insert or delete on public.equipe_permissoes
  for each row execute function public.registrar_auditoria();

-- papel_atual() já devolve null para conta inativa e para troca de senha pendente.
create function public.tem_permissao(p_permissao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when p_permissao is null or not (p_permissao = any (public.catalogo_permissoes())) then false
      when public.papel_atual() = 'admin' then true
      when public.papel_atual() = 'equipe' then exists (
        select 1
        from public.equipe_permissoes e
        where e.profile_id = (select auth.uid())
          and e.permissao = p_permissao
      )
      else false
    end,
    false
  )
$$;

create function public.minhas_permissoes()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.papel_atual()
      when 'admin' then public.catalogo_permissoes()
      when 'equipe' then (
        select array_agg(e.permissao order by e.permissao)
        from public.equipe_permissoes e
        where e.profile_id = (select auth.uid())
      )
    end,
    array[]::text[]
  )
$$;

revoke execute on function public.catalogo_permissoes() from public, anon;
revoke execute on function public.prerequisitos_permissao(text) from public, anon;
revoke execute on function public.tem_permissao(text) from public, anon;
revoke execute on function public.minhas_permissoes() from public, anon;
grant execute on function public.catalogo_permissoes() to authenticated;
grant execute on function public.prerequisitos_permissao(text) to authenticated;
grant execute on function public.tem_permissao(text) to authenticated;
grant execute on function public.minhas_permissoes() to authenticated;

commit;
