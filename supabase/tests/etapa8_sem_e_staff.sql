-- Testes da Etapa 8, onda 4 — e_staff() fora das políticas e das funções, e equipe com as 22 permissões sem poder de promoção.
-- Contrato (docs/ETAPA-8-CONTRATO.md §6): "e_staff() esquecido em algum lugar" e "Funcionário se promove".
-- Foi escrito sem ler as migrations de RLS da onda 4.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo as de RLS da etapa 8, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_sem_e_staff.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa8_sem_e_staff.sql)
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina em ROLLBACK. Se alguma
-- verificação falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O banco de produção tem dados reais: a parte de catálogo só lê pg_policies, pg_proc e pg_views; a parte de
-- promoção usa só linhas da fixture (prefixo 84000000-).
--
-- Contas (ids 84000000-0000-0000-0000-0000000000xx): admin (a1) e outro admin (a2); equipe a22 (e1, as 22 permissões),
--   alvo (e2, equipe sem permissões), inativo (e3, equipe com ativo=false), cliente c1; mais anon.

begin;

-- ---------------------------------------------------------------------------
-- Ajudantes da matriz (existem só dentro da transação).
-- ---------------------------------------------------------------------------

create table public.t8_contas (
  chave text primary key,
  id uuid not null,
  ordem int generated always as identity
);

create function public.t8_conta(
  p_chave text, p_id uuid, p_papel public.papel_usuario,
  p_perms text[] default '{}', p_ativo boolean default true, p_trocar boolean default false
)
returns void
language plpgsql
as $$
declare
  v_permissao text;
begin
  insert into auth.users (id, aud, role, email)
  values (p_id, 'authenticated', 'authenticated', 't8-' || p_chave || '-' || p_id || '@example.com');
  insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
  values (p_id, p_papel, 'T8 ' || p_chave, p_ativo, p_trocar);
  insert into public.t8_contas (chave, id) values (p_chave, p_id);
  foreach v_permissao in array p_perms loop
    insert into public.equipe_permissoes (profile_id, permissao) values (p_id, v_permissao);
  end loop;
end;
$$;

-- Roda um comando como a conta (ou anon / servico = secret key) e devolve o que aconteceu, sem estourar.
create function public.t8_roda(
  p_chave text, p_sql text, p_conta boolean default false,
  out estado text, out linhas bigint, out valor bigint, out msg text
)
language plpgsql
as $$
declare
  v_id uuid;
  v_papel text;
begin
  if p_chave = 'anon' then
    v_papel := 'anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  elsif p_chave = 'servico' then
    v_papel := 'service_role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  else
    select c.id into v_id from public.t8_contas c where c.chave = p_chave;
    if v_id is null then
      raise exception 'FALHA: conta de teste % não existe', p_chave;
    end if;
    v_papel := 'authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  end if;
  -- O Supabase recusa DELETE direto em storage.objects sem este aviso; a recusa que importa é a da política.
  perform set_config('storage.allow_delete_query', 'true', true);
  execute format('set local role %I', v_papel);
  begin
    if p_conta then
      execute p_sql into valor;
      linhas := valor;
    else
      execute p_sql;
      get diagnostics linhas = row_count;
    end if;
    estado := '00000';
  exception when others then
    estado := sqlstate;
    msg := sqlerrm;
    linhas := 0;
  end;
  execute 'reset role';
end;
$$;

-- Leitura: cada conta (e anon) enxerga p_total linhas se estiver em p_quem, senão 0; p_outros troca o esperado
-- de uma conta (valor null = não afirmar nada sobre ela).
create function public.t8_ve(p_sql text, p_total bigint, p_quem text[], p_outros jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
declare
  v_chave text;
  v_esperado bigint;
  v_veio bigint;
  r record;
begin
  for v_chave in select c.chave from public.t8_contas c union all select 'anon' loop
    if p_outros ? v_chave then
      if jsonb_typeof(p_outros -> v_chave) = 'null' then
        continue;
      end if;
      v_esperado := (p_outros ->> v_chave)::bigint;
    elsif v_chave = any (p_quem) then
      v_esperado := p_total;
    else
      v_esperado := 0;
    end if;

    select * into r from public.t8_roda(v_chave, 'select count(*) from (' || p_sql || ') t8_q', true);
    if r.estado = '42501' then
      v_veio := 0;
    elsif r.estado <> '00000' then
      raise exception 'FALHA: leitura por % deu erro % (%) em [%]', v_chave, r.estado, r.msg, left(p_sql, 200);
    else
      v_veio := r.valor;
    end if;

    if v_veio <> v_esperado then
      raise exception 'FALHA: % deveria enxergar % linha(s) em [%] e enxergou %', v_chave, v_esperado, left(p_sql, 200), v_veio;
    end if;
  end loop;
end;
$$;

-- Escrita: só as contas de p_quem conseguem (e afetam p_linhas linhas); as outras são recusadas por erro de
-- permissão/trigger ou não afetam linha nenhuma. p_prep roda como postgres antes de cada tentativa.
-- {u} vira um uuid novo por tentativa; {n} vira o número da conta.
create function public.t8_escreve(
  p_sql text, p_quem text[], p_msg text, p_prep text default null, p_linhas bigint default 1
)
returns void
language plpgsql
as $$
declare
  v_chave text;
  v_u text;
  v_ordem int;
  v_sql text;
  r record;
begin
  for v_chave in select c.chave from public.t8_contas c union all select 'anon' loop
    v_u := gen_random_uuid()::text;
    select c.ordem into v_ordem from public.t8_contas c where c.chave = v_chave;
    v_ordem := coalesce(v_ordem, 99);
    v_sql := replace(replace(p_sql, '{u}', v_u), '{n}', v_ordem::text);
    if p_prep is not null then
      execute replace(replace(p_prep, '{u}', v_u), '{n}', v_ordem::text);
    end if;

    select * into r from public.t8_roda(v_chave, v_sql);
    if v_chave = any (p_quem) then
      if r.estado <> '00000' then
        raise exception 'FALHA: % deveria conseguir (%) e deu erro % (%)', v_chave, p_msg, r.estado, r.msg;
      end if;
      if r.linhas <> p_linhas then
        raise exception 'FALHA: % afetou % linha(s) em (%), esperado %', v_chave, r.linhas, p_msg, p_linhas;
      end if;
    elsif r.estado = '00000' then
      if r.linhas > 0 then
        raise exception 'FALHA: % não deveria conseguir (%) e afetou % linha(s)', v_chave, p_msg, r.linhas;
      end if;
    elsif r.estado <> all (array['42501', '23514', 'P0001', '55000', 'P0002']) then
      raise exception 'FALHA: % foi recusado por motivo inesperado em (%): % (%)', v_chave, p_msg, r.estado, r.msg;
    end if;
  end loop;
end;
$$;

-- Uma conta só: tem que conseguir.
create function public.t8_pode(p_chave text, p_sql text, p_msg text, p_linhas bigint default 1)
returns void
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.t8_roda(p_chave, p_sql);
  if r.estado <> '00000' then
    raise exception 'FALHA: % deveria conseguir (%) e deu erro % (%)', p_chave, p_msg, r.estado, r.msg;
  end if;
  if r.linhas <> p_linhas then
    raise exception 'FALHA: % afetou % linha(s) em (%), esperado %', p_chave, r.linhas, p_msg, p_linhas;
  end if;
end;
$$;

-- Uma conta só: tem que ser recusada.
create function public.t8_nao_pode(p_chave text, p_sql text, p_msg text)
returns void
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.t8_roda(p_chave, p_sql);
  if r.estado = '00000' then
    if r.linhas > 0 then
      raise exception 'FALHA: % não deveria conseguir (%) e afetou % linha(s)', p_chave, p_msg, r.linhas;
    end if;
  elsif r.estado <> all (array['42501', '23514', 'P0001', '55000', 'P0002']) then
    raise exception 'FALHA: % foi recusado por motivo inesperado em (%): % (%)', p_chave, p_msg, r.estado, r.msg;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Nenhuma política (public e storage) usa e_staff().
-- ---------------------------------------------------------------------------

do $$
declare
  v_lista text;
  v_com_permissao integer;
begin
  select string_agg(p.schemaname || '.' || p.tablename || ' [' || p.policyname || ']', '; ' order by p.schemaname, p.tablename, p.policyname)
    into v_lista
    from pg_policies p
   where p.schemaname in ('public', 'storage')
     and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~* '(^|[^a-z0-9_])e_staff([^a-z0-9_]|$)';
  if v_lista is not null then
    raise exception 'FALHA: política(s) ainda usam e_staff(): %', v_lista;
  end if;

  -- Sanidade da própria consulta: ela tem que enxergar as políticas novas, senão o teste acima não prova nada.
  select count(*) into v_com_permissao
    from pg_policies p
   where p.schemaname in ('public', 'storage')
     and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~* 'tem_permissao';
  if v_com_permissao < 10 then
    raise exception 'FALHA: só % política(s) usam tem_permissao; a troca de e_staff() não aconteceu ou a consulta não enxerga o texto', v_com_permissao;
  end if;

  -- As 5 políticas de storage.objects que existiam continuam existindo, agora sem e_staff.
  if (select count(*) from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects') < 5 then
    raise exception 'FALHA: storage.objects deveria manter ao menos as 5 políticas de leitura/apagar por bucket';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Nenhuma função (fora a própria e_staff) cita e_staff() no corpo; nenhuma view também.
-- ---------------------------------------------------------------------------

do $$
declare
  v_lista text;
begin
  select string_agg(n.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')', '; '
                    order by n.nspname, f.proname)
    into v_lista
    from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
     and not (n.nspname = 'public' and f.proname = 'e_staff')
     and f.prosrc ~* '(^|[^a-z0-9_])e_staff([^a-z0-9_]|$)';
  if v_lista is not null then
    raise exception 'FALHA: função(ões) ainda citam e_staff() no corpo: %', v_lista;
  end if;

  select string_agg(v.schemaname || '.' || v.viewname, '; ' order by v.schemaname, v.viewname)
    into v_lista
    from pg_views v
   where v.schemaname in ('public', 'storage')
     and v.definition ~* '(^|[^a-z0-9_])e_staff([^a-z0-9_]|$)';
  if v_lista is not null then
    raise exception 'FALHA: view(s) ainda citam e_staff(): %', v_lista;
  end if;

  -- Sanidade: a consulta enxerga corpos de função (tem_permissao existe e é citada por alguma função de checagem).
  if not exists (
    select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
     where n.nspname = 'public' and f.prosrc ~* 'tem_permissao' and f.proname <> 'tem_permissao'
  ) then
    raise exception 'FALHA: nenhuma função do public usa tem_permissao; a troca de e_staff() nas funções não aconteceu';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Equipe com as 22 permissões não se promove: profiles.papel, profiles.ativo e equipe_permissoes só mudam pelo admin.
-- ---------------------------------------------------------------------------

select public.t8_conta('admin', '84000000-0000-0000-0000-0000000000a1', 'admin');
select public.t8_conta('admin2', '84000000-0000-0000-0000-0000000000a2', 'admin');
select public.t8_conta('a22', '84000000-0000-0000-0000-0000000000e1', 'equipe', public.catalogo_permissoes());
select public.t8_conta('alvo', '84000000-0000-0000-0000-0000000000e2', 'equipe');
select public.t8_conta('inativo', '84000000-0000-0000-0000-0000000000e3', 'equipe', '{}', false, false);
select public.t8_conta('c1', '84000000-0000-0000-0000-0000000000c1', 'cliente');

-- Sanidade: a conta tem mesmo as 22 permissões ativas (senão "não consegue" não provaria nada).
do $$
declare
  v_permissao text;
  r record;
begin
  foreach v_permissao in array public.catalogo_permissoes() loop
    select * into r from public.t8_roda('a22', format('select case when public.tem_permissao(%L) then 1 else 0 end', v_permissao), true);
    if r.estado <> '00000' or r.valor is distinct from 1 then
      raise exception 'FALHA: a conta com as 22 permissões deveria ter %, estado % valor %', v_permissao, r.estado, r.valor;
    end if;
  end loop;
end $$;

-- profiles: nenhuma coluna muda pela sessão, nem na própria linha, nem na de outra pessoa, nem nas de admin.
select public.t8_nao_pode('a22',
  $q$update public.profiles set papel = 'admin' where id = '84000000-0000-0000-0000-0000000000e1'$q$,
  'equipe com as 22 se promover a admin');
select public.t8_nao_pode('a22',
  $q$update public.profiles set papel = 'admin' where id = '84000000-0000-0000-0000-0000000000e2'$q$,
  'equipe com as 22 promover outra conta a admin');
select public.t8_nao_pode('a22',
  $q$update public.profiles set papel = 'equipe' where id = '84000000-0000-0000-0000-0000000000a2'$q$,
  'equipe com as 22 rebaixar admin');
select public.t8_nao_pode('a22',
  $q$update public.profiles set papel = 'cliente' where id = '84000000-0000-0000-0000-0000000000e2'$q$,
  'equipe com as 22 trocar o papel de outra conta');
select public.t8_nao_pode('a22',
  $q$update public.profiles set ativo = false where id = '84000000-0000-0000-0000-0000000000a1'$q$,
  'equipe com as 22 desativar o admin');
select public.t8_nao_pode('a22',
  $q$update public.profiles set ativo = false where id = '84000000-0000-0000-0000-0000000000e1'$q$,
  'equipe com as 22 desativar a si mesma');
select public.t8_nao_pode('a22',
  $q$update public.profiles set ativo = true where id = '84000000-0000-0000-0000-0000000000e3'$q$,
  'equipe com as 22 reativar conta inativa');
select public.t8_nao_pode('a22',
  $q$update public.profiles set precisa_trocar_senha = true where id = '84000000-0000-0000-0000-0000000000a1'$q$,
  'equipe com as 22 forçar troca de senha do admin');
select public.t8_nao_pode('a22',
  $q$update public.profiles set nome = 'T8 trocado' where id = '84000000-0000-0000-0000-0000000000e2'$q$,
  'equipe com as 22 renomear outra conta');
select public.t8_nao_pode('a22',
  $q$insert into public.profiles (id, papel, nome) values ('84000000-0000-0000-0000-0000000000e9', 'admin', 'T8 intruso')$q$,
  'equipe com as 22 criar perfil de admin');
select public.t8_nao_pode('a22',
  $q$delete from public.profiles where id = '84000000-0000-0000-0000-0000000000e2'$q$,
  'equipe com as 22 apagar perfil');

-- equipe_permissoes: só o admin concede e remove; ninguém altera linha.
select public.t8_nao_pode('a22',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('84000000-0000-0000-0000-0000000000e2', 'site.ver')$q$,
  'equipe com as 22 conceder permissão a outra conta');
select public.t8_nao_pode('a22',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('84000000-0000-0000-0000-0000000000e3', 'financeiro.ver')$q$,
  'equipe com as 22 conceder permissão a conta inativa');
select public.t8_nao_pode('a22',
  $q$delete from public.equipe_permissoes where profile_id = '84000000-0000-0000-0000-0000000000e1'$q$,
  'equipe com as 22 remover as próprias permissões');
select public.t8_nao_pode('a22',
  $q$update public.equipe_permissoes set concedida_em = now() where profile_id = '84000000-0000-0000-0000-0000000000e1'$q$,
  'equipe com as 22 alterar as próprias permissões');
select public.t8_nao_pode('a22',
  $q$update public.equipe_permissoes set profile_id = '84000000-0000-0000-0000-0000000000e2' where profile_id = '84000000-0000-0000-0000-0000000000e1'$q$,
  'equipe com as 22 passar permissões para outra conta');

-- O mesmo vale para quem não tem nada, para cliente e para anon.
select public.t8_nao_pode('alvo',
  $q$update public.profiles set papel = 'admin' where id = '84000000-0000-0000-0000-0000000000e2'$q$,
  'equipe sem permissões se promover a admin');
select public.t8_nao_pode('c1',
  $q$update public.profiles set papel = 'admin' where id = '84000000-0000-0000-0000-0000000000c1'$q$,
  'cliente se promover a admin');
select public.t8_nao_pode('c1',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('84000000-0000-0000-0000-0000000000e2', 'site.ver')$q$,
  'cliente conceder permissão');
select public.t8_nao_pode('anon',
  $q$update public.profiles set papel = 'admin' where id = '84000000-0000-0000-0000-0000000000e2'$q$,
  'anon promover conta');
select public.t8_nao_pode('anon',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('84000000-0000-0000-0000-0000000000e2', 'site.ver')$q$,
  'anon conceder permissão');

-- Depois de tudo isso nada mudou: papéis, situação e permissões.
do $$
begin
  if (select papel from public.profiles where id = '84000000-0000-0000-0000-0000000000e1') <> 'equipe'
     or (select papel from public.profiles where id = '84000000-0000-0000-0000-0000000000e2') <> 'equipe'
     or (select papel from public.profiles where id = '84000000-0000-0000-0000-0000000000a2') <> 'admin'
     or (select papel from public.profiles where id = '84000000-0000-0000-0000-0000000000c1') <> 'cliente' then
    raise exception 'FALHA: algum papel mudou pela sessão';
  end if;
  if not (select ativo from public.profiles where id = '84000000-0000-0000-0000-0000000000a1')
     or not (select ativo from public.profiles where id = '84000000-0000-0000-0000-0000000000e1')
     or (select ativo from public.profiles where id = '84000000-0000-0000-0000-0000000000e3') then
    raise exception 'FALHA: alguma conta teve o ativo alterado pela sessão';
  end if;
  if (select precisa_trocar_senha from public.profiles where id = '84000000-0000-0000-0000-0000000000a1') then
    raise exception 'FALHA: a equipe forçou a troca de senha do admin';
  end if;
  if (select count(*) from public.equipe_permissoes where profile_id = '84000000-0000-0000-0000-0000000000e1') <> 24 then
    raise exception 'FALHA: a equipe com as 24 deveria seguir com 24 permissões';
  end if;
  if exists (select 1 from public.equipe_permissoes where profile_id in (
        '84000000-0000-0000-0000-0000000000e2', '84000000-0000-0000-0000-0000000000e3')) then
    raise exception 'FALHA: alguém concedeu permissão a uma conta da fixture pela sessão';
  end if;
end $$;

-- O admin concede e remove (a conta a22 não: é o contraste que dá sentido ao teste).
select public.t8_pode('admin',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('84000000-0000-0000-0000-0000000000e2', 'site.ver')$q$,
  'admin conceder permissão');
select public.t8_pode('admin',
  $q$delete from public.equipe_permissoes where profile_id = '84000000-0000-0000-0000-0000000000e2' and permissao = 'site.ver'$q$,
  'admin remover permissão');

select 'OK: nenhuma política nem função usa e_staff(), e a equipe com as 22 permissões não se promove' as resultado;

rollback;
