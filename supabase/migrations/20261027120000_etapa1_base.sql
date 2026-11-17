-- Etapa 1 — base do banco: papéis, perfis, auditoria e rate limit.
-- Contrato: docs/ETAPA-1-CONTRATO.md (seção "Banco").
-- Toda tabela abaixo ativa RLS nesta mesma migration. Escrita em profiles só
-- pelo client admin (secret key), que ignora o RLS: por isso não há política
-- de insert/update/delete.

-- Papéis de acesso do sistema.
create type public.papel_usuario as enum (
  'admin',
  'equipe',
  'cliente',
  'empreiteiro',
  'fornecedor'
);

-- Trigger genérico before update: mantém atualizado_em sempre correto.
create function public.definir_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

revoke execute on function public.definir_atualizado_em() from public, anon, authenticated;

-- Perfis: um por conta em auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  papel public.papel_usuario not null,
  nome text not null,
  telefone text,
  ativo boolean not null default true,
  precisa_trocar_senha boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Nunca lido anonimamente; usuário logado só lê (a escrita é só do client admin).
revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

-- Funções de papel. Security definer para ler profiles sem passar pelo RLS
-- (evita recursão nas políticas de profiles que chamam e_staff()).
create function public.papel_atual()
returns public.papel_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select p.papel
  from public.profiles p
  where p.id = (select auth.uid())
    and p.ativo
$$;

create function public.e_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() in ('admin', 'equipe'), false)
$$;

create function public.e_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'admin', false)
$$;

revoke execute on function public.papel_atual() from public, anon;
revoke execute on function public.e_staff() from public, anon;
revoke execute on function public.e_admin() from public, anon;
grant execute on function public.papel_atual() to authenticated;
grant execute on function public.e_staff() to authenticated;
grant execute on function public.e_admin() to authenticated;

create policy "usuário lê o próprio perfil"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy "staff lê todos os perfis"
  on public.profiles
  for select
  to authenticated
  using ((select public.e_staff()));

-- Auditoria: só o trigger registra; só admin lê.
create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  tabela text not null,
  registro_id uuid,
  acao text not null check (acao in ('INSERT', 'UPDATE', 'DELETE')),
  ator_id uuid,
  antes jsonb,
  depois jsonb,
  em timestamptz not null default now()
);

create index auditoria_tabela_registro_idx on public.auditoria (tabela, registro_id);
create index auditoria_em_idx on public.auditoria (em desc);

alter table public.auditoria enable row level security;

revoke all on table public.auditoria from anon;
revoke all on table public.auditoria from authenticated;
grant select on table public.auditoria to authenticated;

create policy "admin lê a auditoria"
  on public.auditoria
  for select
  to authenticated
  using ((select public.e_admin()));

-- ator_id fica null quando a escrita vem do client admin (sem auth.uid()).
create function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria (tabela, registro_id, acao, ator_id, antes, depois)
    values (tg_table_name, new.id, tg_op, (select auth.uid()), null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.auditoria (tabela, registro_id, acao, ator_id, antes, depois)
    values (tg_table_name, new.id, tg_op, (select auth.uid()), to_jsonb(old), to_jsonb(new));
    return new;
  end if;

  insert into public.auditoria (tabela, registro_id, acao, ator_id, antes, depois)
  values (tg_table_name, old.id, tg_op, (select auth.uid()), to_jsonb(old), null);
  return old;
end;
$$;

revoke execute on function public.registrar_auditoria() from public, anon, authenticated;

create trigger profiles_definir_atualizado_em
  before update on public.profiles
  for each row execute function public.definir_atualizado_em();

create trigger profiles_registrar_auditoria
  after insert or update or delete on public.profiles
  for each row execute function public.registrar_auditoria();

-- Rate limit: RLS ligado e sem políticas (ninguém acessa direto); o acesso é
-- só pela função verificar_rate_limit, chamada com a secret key.
create table public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  janela_inicio timestamptz not null default now(),
  contagem int not null default 0
);

alter table public.rate_limits enable row level security;

revoke all on table public.rate_limits from anon;
revoke all on table public.rate_limits from authenticated;

-- true = permitido, false = bloqueado. Um único upsert atômico: se a janela
-- venceu, reinicia a contagem em 1; senão incrementa.
create function public.verificar_rate_limit(
  p_chave text,
  p_limite int,
  p_janela_segundos int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contagem int;
begin
  insert into public.rate_limits as rl (chave, janela_inicio, contagem)
  values (p_chave, now(), 1)
  on conflict (chave) do update
  set janela_inicio = case
        when rl.janela_inicio + make_interval(secs => p_janela_segundos) <= now()
          then now()
        else rl.janela_inicio
      end,
      contagem = case
        when rl.janela_inicio + make_interval(secs => p_janela_segundos) <= now()
          then 1
        else rl.contagem + 1
      end
  returning rl.contagem into v_contagem;

  return v_contagem <= p_limite;
end;
$$;

revoke execute on function public.verificar_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.verificar_rate_limit(text, int, int) to service_role;
