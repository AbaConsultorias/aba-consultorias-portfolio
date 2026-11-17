-- Testes da Etapa 8, onda 2 — contas internas: proteção do último admin, listar_contas_internas e salvar_permissoes_equipe.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo 20261105100000_etapa8_permissoes.sql e
-- 20261105110000_etapa8_contas_internas.sql, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_contas_internas.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa8_contas_internas.sql)
-- Rode com o usuário postgres, em banco de teste (ou em produção: nada fica). Tudo acontece dentro de uma
-- transação que termina em ROLLBACK. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
--
-- O banco pode já ter admins reais. Em vez de desligar o trigger, a fixture entra com 2 admins ativos e só então
-- os admins reais são desativados (o trigger deixa, porque sobram os da fixture); a partir daí os admins ativos
-- são só os da fixture, e o cenário do "último admin" é montado só com eles.
--
-- Fixture (ids com prefixo 81000000-...; o sufixo mostra o papel):
--   admins: a1 (ativo), a2 (ativo), a3 (inativo, descartável: é apagado), a4 (inativo, fica);
--   equipe: e1 (ativa; site.ver, site.editar, financeiro.ver), e2 (inativa; site.ver), e3 (troca de senha pendente; site.ver),
--           e4 (ativa; as 22), e5 (ativa; sem linhas, alvo do salvar), e6 (ativa; sem linhas, alvo das recusas);
--   cliente c1, empreiteiro b1, fornecedor f1.
-- Ajudantes e8_teste_* são criados aqui dentro e somem no rollback.

begin;

insert into auth.users (id, aud, role, email, last_sign_in_at)
values
  ('81000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e8b-admin1@example.com', '2026-11-02 09:00:00+00'),
  ('81000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'e8b-admin2@example.com', null),
  ('81000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', 'e8b-admin3@example.com', null),
  ('81000000-0000-0000-0000-0000000000a4', 'authenticated', 'authenticated', 'e8b-admin4@example.com', null),
  ('81000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e8b-equipe1@example.com', '2026-11-01 10:00:00+00'),
  ('81000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'e8b-equipe2@example.com', null),
  ('81000000-0000-0000-0000-0000000000e3', 'authenticated', 'authenticated', 'e8b-equipe3@example.com', null),
  ('81000000-0000-0000-0000-0000000000e4', 'authenticated', 'authenticated', 'e8b-equipe4@example.com', null),
  ('81000000-0000-0000-0000-0000000000e5', 'authenticated', 'authenticated', 'e8b-equipe5@example.com', null),
  ('81000000-0000-0000-0000-0000000000e6', 'authenticated', 'authenticated', 'e8b-equipe6@example.com', null),
  ('81000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e8b-cliente@example.com', null),
  ('81000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e8b-empreiteiro@example.com', null),
  ('81000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e8b-fornecedor@example.com', null);

insert into public.profiles (id, papel, nome, telefone, ativo, precisa_trocar_senha)
values
  ('81000000-0000-0000-0000-0000000000a1', 'admin', 'Admin 1 Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000a2', 'admin', 'Admin 2 Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000a3', 'admin', 'Admin 3 Descartável Teste E8B', null, false, false),
  ('81000000-0000-0000-0000-0000000000a4', 'admin', 'Admin 4 Inativo Teste E8B', null, false, false),
  ('81000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe 1 Teste E8B', '11988887777', true, false),
  ('81000000-0000-0000-0000-0000000000e2', 'equipe', 'Equipe 2 Inativa Teste E8B', null, false, false),
  ('81000000-0000-0000-0000-0000000000e3', 'equipe', 'Equipe 3 Troca Pendente Teste E8B', null, true, true),
  ('81000000-0000-0000-0000-0000000000e4', 'equipe', 'Equipe 4 Completa Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000e5', 'equipe', 'Equipe 5 Alvo Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000e6', 'equipe', 'Equipe 6 Restrições Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste E8B', null, true, false),
  ('81000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor Teste E8B', null, true, false);

-- Com a1 e a2 ativos, o trigger deixa desativar os admins reais (se houver): sobram só os da fixture.
update public.profiles
   set ativo = false
 where papel = 'admin' and ativo and id::text not like '81000000-%';

insert into public.equipe_permissoes (profile_id, permissao)
values
  ('81000000-0000-0000-0000-0000000000e1', 'site.ver'),
  ('81000000-0000-0000-0000-0000000000e1', 'site.editar'),
  ('81000000-0000-0000-0000-0000000000e1', 'financeiro.ver'),
  ('81000000-0000-0000-0000-0000000000e2', 'site.ver'),
  ('81000000-0000-0000-0000-0000000000e3', 'site.ver');

do $$
declare
  v_permissao text;
begin
  foreach v_permissao in array public.catalogo_permissoes() loop
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('81000000-0000-0000-0000-0000000000e4', v_permissao);
  end loop;
end $$;

-- Ajudantes de teste (security definer: leem as tabelas sem passar pelo RLS, seja qual for a sessão).
create function public.e8_teste_permissoes_de(p_profile_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(e.permissao order by e.permissao), array[]::text[])
  from public.equipe_permissoes e
  where e.profile_id = p_profile_id
$$;

create function public.e8_teste_iguais(p_a text[], p_b text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_a @> p_b and p_a <@ p_b
$$;

create function public.e8_teste_auditoria(p_profile_id uuid, p_acao text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.auditoria a
  where a.tabela = 'equipe_permissoes'
    and (coalesce(a.depois, a.antes) ->> 'profile_id')::uuid = p_profile_id
    and a.acao = p_acao
$$;

create function public.e8_teste_auditoria_de_outro_ator(p_profile_id uuid, p_ator uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.auditoria a
  where a.tabela = 'equipe_permissoes'
    and (coalesce(a.depois, a.antes) ->> 'profile_id')::uuid = p_profile_id
    and a.ator_id is distinct from p_ator
$$;

create function public.e8_teste_auditoria_total()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from public.auditoria a where a.tabela = 'equipe_permissoes'
$$;

-- ---------------------------------------------------------------------------
-- Estrutura: trigger, funções, grants.
-- ---------------------------------------------------------------------------

do $$
declare
  v_tgtype integer;
  v_funcao record;
begin
  select t.tgtype into v_tgtype
  from pg_trigger t
  where t.tgrelid = 'public.profiles'::regclass
    and t.tgname = 'profiles_proteger_ultimo_admin'
    and not t.tgisinternal
    and t.tgenabled = 'O';
  if v_tgtype is null then
    raise exception 'FALHA: trigger profiles_proteger_ultimo_admin não existe ou não está ligado';
  end if;
  -- bits do tgtype: 1 = por linha, 2 = before, 4 = insert, 8 = delete, 16 = update
  if (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0 or (v_tgtype & 8) = 0 or (v_tgtype & 16) = 0 or (v_tgtype & 4) <> 0 then
    raise exception 'FALHA: o trigger deveria ser BEFORE UPDATE OR DELETE, por linha (tgtype %)', v_tgtype;
  end if;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.profiles'::regclass
         and t.tgname in ('profiles_definir_atualizado_em', 'profiles_registrar_auditoria')) <> 2 then
    raise exception 'FALHA: os triggers que já existiam em profiles deveriam continuar lá';
  end if;

  for v_funcao in
    select * from (values
      ('public.proteger_ultimo_admin()'::regprocedure, true),
      ('public.listar_contas_internas()'::regprocedure, true),
      ('public.salvar_permissoes_equipe(uuid, text[])'::regprocedure, false)
    ) as t(funcao, esperado_definer)
  loop
    if (select p.prosecdef from pg_proc p where p.oid = v_funcao.funcao) is distinct from v_funcao.esperado_definer then
      raise exception 'FALHA: security definer de % deveria ser %', v_funcao.funcao::text, v_funcao.esperado_definer;
    end if;
    if not exists (
      select 1 from pg_proc p, unnest(p.proconfig) as c(valor)
       where p.oid = v_funcao.funcao and c.valor like 'search_path=%'
    ) then
      raise exception 'FALHA: % deveria fixar o search_path', v_funcao.funcao::text;
    end if;
  end loop;

  if (select p.provolatile from pg_proc p where p.oid = 'public.listar_contas_internas()'::regprocedure) <> 's' then
    raise exception 'FALHA: listar_contas_internas deveria ser stable';
  end if;

  if has_function_privilege('anon', 'public.listar_contas_internas()', 'execute')
     or has_function_privilege('anon', 'public.salvar_permissoes_equipe(uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.proteger_ultimo_admin()', 'execute')
     or has_function_privilege('authenticated', 'public.proteger_ultimo_admin()', 'execute') then
    raise exception 'FALHA: anon não pode executar as funções novas e a função do trigger não é chamável por authenticated';
  end if;
  if not (has_function_privilege('authenticated', 'public.listar_contas_internas()', 'execute')
          and has_function_privilege('authenticated', 'public.salvar_permissoes_equipe(uuid, text[])', 'execute')) then
    raise exception 'FALHA: authenticated deveria executar listar_contas_internas e salvar_permissoes_equipe';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Último admin: o banco recusa desativar, rebaixar e apagar, até para o postgres e a secret key.
-- ---------------------------------------------------------------------------

do $$
declare
  v_a1 constant uuid := '81000000-0000-0000-0000-0000000000a1';
  v_a2 constant uuid := '81000000-0000-0000-0000-0000000000a2';
  v_a3 constant uuid := '81000000-0000-0000-0000-0000000000a3';
  v_a4 constant uuid := '81000000-0000-0000-0000-0000000000a4';
  v_sql text;
  v_papel text;
  v_linhas integer;
begin
  if (select array_agg(p.id order by p.id) from public.profiles p where p.papel = 'admin' and p.ativo)
     is distinct from array[v_a1, v_a2] then
    raise exception 'FALHA: os únicos admins ativos deveriam ser a1 e a2 (os admins reais não foram desativados no cenário)';
  end if;

  -- Com 2 admins ativos, mexer nos dois ao mesmo tempo é recusado: o segundo da mesma instrução já é o último.
  foreach v_sql in array array[
    format('update public.profiles set ativo = false where id in (%L, %L)', v_a1, v_a2),
    format('update public.profiles set papel = ''equipe'' where id in (%L, %L)', v_a1, v_a2),
    format('delete from public.profiles where id in (%L, %L)', v_a1, v_a2)
  ] loop
    begin
      execute v_sql;
      raise exception 'FALHA: a instrução que tirava os dois admins ativos passou: %', v_sql;
    exception when check_violation then
      if sqlerrm not like '%último administrador%' then
        raise exception 'FALHA: recusada por outro motivo (%): %', v_sql, sqlerrm;
      end if;
    end;
  end loop;
  if (select count(*) from public.profiles p where p.papel = 'admin' and p.ativo) <> 2 then
    raise exception 'FALHA: as instruções recusadas deixaram um admin desativado ou rebaixado';
  end if;

  -- Com 2 admins ativos, desativar 1 funciona; o outro passa a ser o último.
  update public.profiles set ativo = false where id = v_a2;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 or (select count(*) from public.profiles p where p.papel = 'admin' and p.ativo) <> 1 then
    raise exception 'FALHA: com 2 admins ativos, desativar 1 deveria funcionar e sobrar só o a1';
  end if;

  -- O último (a1) fica protegido para o postgres e para o service_role.
  foreach v_papel in array array['postgres', 'service_role'] loop
    perform set_config('request.jwt.claims', '', true);
    foreach v_sql in array array[
      format('update public.profiles set ativo = false where id = %L', v_a1),
      format('update public.profiles set papel = ''equipe'' where id = %L', v_a1),
      format('update public.profiles set papel = ''cliente'', ativo = false where id = %L', v_a1),
      format('delete from public.profiles where id = %L', v_a1)
    ] loop
      execute case v_papel when 'postgres' then 'reset role' else format('set local role %I', v_papel) end;
      begin
        execute v_sql;
        execute 'reset role';
        raise exception 'FALHA: % tirou o último admin: %', v_papel, v_sql;
      exception when check_violation then
        execute 'reset role';
        if sqlerrm not like '%último administrador%' then
          raise exception 'FALHA: % recusado por outro motivo (%): %', v_papel, v_sql, sqlerrm;
        end if;
      end;
    end loop;
  end loop;

  -- Apagar o usuário do Auth leva o perfil junto (on delete cascade): o trigger também barra.
  begin
    delete from auth.users where id = v_a1;
    raise exception 'FALHA: apagar o usuário do Auth do último admin passou';
  exception when check_violation then
    if sqlerrm not like '%último administrador%' then
      raise exception 'FALHA: apagar o usuário do Auth recusado por outro motivo: %', sqlerrm;
    end if;
  end;

  if not exists (select 1 from public.profiles p where p.id = v_a1 and p.papel = 'admin' and p.ativo)
     or not exists (select 1 from auth.users u where u.id = v_a1) then
    raise exception 'FALHA: o a1 deveria seguir admin, ativo e existindo';
  end if;

  -- Mudar o que não é papel nem ativo no último admin funciona (postgres e service_role), inclusive o update sem efeito.
  foreach v_papel in array array['postgres', 'service_role'] loop
    perform set_config('request.jwt.claims', '', true);
    execute case v_papel when 'postgres' then 'reset role' else format('set local role %I', v_papel) end;
    update public.profiles
       set nome = 'Admin 1 Renomeado ' || v_papel, telefone = '11977776666'
     where id = v_a1;
    get diagnostics v_linhas = row_count;
    update public.profiles set ativo = true, papel = 'admin' where id = v_a1;
    execute 'reset role';
    if v_linhas <> 1 then
      raise exception 'FALHA: % deveria conseguir mudar o nome do último admin', v_papel;
    end if;
  end loop;
  if (select p.nome from public.profiles p where p.id = v_a1) <> 'Admin 1 Renomeado service_role' then
    raise exception 'FALHA: o nome do último admin não mudou';
  end if;

  -- Admin inativo pode ser mudado à vontade: nome, papel de volta e para frente, e apagado.
  update public.profiles set nome = 'Admin 3 Renomeado' where id = v_a3;
  update public.profiles set papel = 'equipe' where id = v_a3;
  update public.profiles set papel = 'admin' where id = v_a3;
  update public.profiles set papel = 'cliente' where id = v_a2;
  update public.profiles set papel = 'admin', nome = 'Admin 2 Teste E8B' where id = v_a2;
  update public.profiles set telefone = '11955554444' where id = v_a4;
  delete from public.profiles where id = v_a3;
  if exists (select 1 from public.profiles p where p.id = v_a3) then
    raise exception 'FALHA: o admin inativo a3 deveria ter sido apagado';
  end if;
  if (select count(*) from public.profiles p where p.papel = 'admin' and p.ativo) <> 1 then
    raise exception 'FALHA: mexer em admins inativos não deveria mudar quem está ativo';
  end if;

  -- Reativar o a2 devolve 2 admins ativos: desativar o a1 passa e o a2 vira o protegido.
  update public.profiles set ativo = true where id = v_a2;
  update public.profiles set ativo = false where id = v_a1;
  foreach v_sql in array array[
    format('update public.profiles set ativo = false where id = %L', v_a2),
    format('update public.profiles set papel = ''equipe'' where id = %L', v_a2),
    format('delete from public.profiles where id = %L', v_a2)
  ] loop
    begin
      execute v_sql;
      raise exception 'FALHA: o a2 virou o último admin e foi tirado: %', v_sql;
    exception when check_violation then
      if sqlerrm not like '%último administrador%' then
        raise exception 'FALHA: recusado por outro motivo (%): %', v_sql, sqlerrm;
      end if;
    end;
  end loop;

  update public.profiles set ativo = true where id = v_a1;
  if (select array_agg(p.id order by p.id) from public.profiles p where p.papel = 'admin' and p.ativo)
     is distinct from array[v_a1, v_a2] then
    raise exception 'FALHA: ao fim deveriam sobrar a1 e a2 ativos';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- listar_contas_internas
-- ---------------------------------------------------------------------------

do $$
declare
  v_chaves text[] := array['id', 'nome', 'telefone', 'papel', 'ativo', 'precisa_trocar_senha', 'identificador', 'ultimo_acesso', 'permissoes'];
  v_lista jsonb;
  v_ids uuid[];
  v_ordenados uuid[];
  v_linha jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '81000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lista from public.listar_contas_internas() as l;
  execute 'reset role';

  -- Só admin e equipe; nenhum cliente, empreiteiro ou fornecedor.
  if exists (select 1 from jsonb_array_elements(v_lista) as x(linha) where x.linha ->> 'papel' not in ('admin', 'equipe')) then
    raise exception 'FALHA: a lista trouxe conta que não é admin nem equipe';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lista) as x(linha)
     where x.linha ->> 'id' in ('81000000-0000-0000-0000-0000000000c1',
                                 '81000000-0000-0000-0000-0000000000b1',
                                 '81000000-0000-0000-0000-0000000000f1')
  ) then
    raise exception 'FALHA: a lista trouxe o cliente, o empreiteiro ou o fornecedor da fixture';
  end if;
  if (select count(*) from jsonb_array_elements(v_lista) as x(linha) where x.linha ->> 'id' like '81000000-%') <> 9 then
    raise exception 'FALHA: a lista deveria ter as 9 contas internas da fixture (a1, a2, a4, e1 a e6)';
  end if;
  if (select count(*) from jsonb_array_elements(v_lista) as x(linha)) <>
     (select count(*) from public.profiles p where p.papel in ('admin', 'equipe')) then
    raise exception 'FALHA: a lista deveria trazer todos os perfis admin e equipe';
  end if;

  -- Ordem: nome e id.
  v_ids := array(select (x.linha ->> 'id')::uuid from jsonb_array_elements(v_lista) with ordinality as x(linha, n) order by x.n);
  v_ordenados := array(select (x.linha ->> 'id')::uuid from jsonb_array_elements(v_lista) as x(linha)
                        order by x.linha ->> 'nome', (x.linha ->> 'id')::uuid);
  if v_ids is distinct from v_ordenados then
    raise exception 'FALHA: a lista deveria vir ordenada por nome e id';
  end if;

  -- Equipe com permissões, identificador, telefone e último acesso.
  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000e1';
  if v_linha is null then
    raise exception 'FALHA: a equipe e1 não está na lista';
  end if;
  if public.e8_teste_iguais(array(select k from jsonb_object_keys(v_linha) as k), v_chaves) is not true then
    raise exception 'FALHA: as colunas da lista deveriam ser exatamente %, vieram %', v_chaves, v_linha;
  end if;
  if v_linha ->> 'nome' <> 'Equipe 1 Teste E8B'
     or v_linha ->> 'telefone' <> '11988887777'
     or v_linha ->> 'papel' <> 'equipe'
     or (v_linha ->> 'ativo')::boolean is not true
     or (v_linha ->> 'precisa_trocar_senha')::boolean is not false
     or v_linha ->> 'identificador' <> 'e8b-equipe1@example.com'
     or (v_linha ->> 'ultimo_acesso')::timestamptz <> '2026-11-01 10:00:00+00'::timestamptz then
    raise exception 'FALHA: dados da equipe e1 errados na lista: %', v_linha;
  end if;
  if public.e8_teste_iguais(array(select p from jsonb_array_elements_text(v_linha -> 'permissoes') as p),
                            array['site.ver', 'site.editar', 'financeiro.ver']) is not true then
    raise exception 'FALHA: permissões do e1 erradas na lista: %', v_linha -> 'permissoes';
  end if;

  -- Sem linhas: lista vazia, nunca null.
  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000e5';
  if jsonb_typeof(v_linha -> 'permissoes') is distinct from 'array' or jsonb_array_length(v_linha -> 'permissoes') <> 0 then
    raise exception 'FALHA: conta sem permissões deveria vir com lista vazia, veio %', v_linha -> 'permissoes';
  end if;

  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000e4';
  if jsonb_array_length(v_linha -> 'permissoes') <> 24 then
    raise exception 'FALHA: a equipe e4 deveria vir com 24 permissões';
  end if;

  -- Situação: inativa, troca pendente, último acesso nulo, admin.
  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000e2';
  if (v_linha ->> 'ativo')::boolean is not false or jsonb_typeof(v_linha -> 'ultimo_acesso') is distinct from 'null' then
    raise exception 'FALHA: a equipe inativa e2 deveria vir inativa e sem último acesso: %', v_linha;
  end if;
  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000e3';
  if (v_linha ->> 'precisa_trocar_senha')::boolean is not true then
    raise exception 'FALHA: a equipe e3 deveria vir com troca de senha pendente';
  end if;
  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000a1';
  if v_linha ->> 'papel' <> 'admin'
     or v_linha ->> 'identificador' <> 'e8b-admin1@example.com'
     or (v_linha ->> 'ultimo_acesso')::timestamptz <> '2026-11-02 09:00:00+00'::timestamptz
     or jsonb_array_length(v_linha -> 'permissoes') <> 0 then
    raise exception 'FALHA: dados do admin a1 errados na lista: %', v_linha;
  end if;
  select x.linha into v_linha from jsonb_array_elements(v_lista) as x(linha)
   where x.linha ->> 'id' = '81000000-0000-0000-0000-0000000000a4';
  if (v_linha ->> 'ativo')::boolean is not false then
    raise exception 'FALHA: o admin a4 deveria vir inativo';
  end if;
end $$;

-- Quem não é admin ativo, com senha trocada, recebe só o erro.
do $$
declare
  v_caso record;
begin
  for v_caso in
    select * from (values
      ('equipe com as 22 permissões',  '81000000-0000-0000-0000-0000000000e4'::uuid),
      ('equipe com 3 permissões',      '81000000-0000-0000-0000-0000000000e1'::uuid),
      ('equipe inativa',               '81000000-0000-0000-0000-0000000000e2'::uuid),
      ('equipe com troca pendente',    '81000000-0000-0000-0000-0000000000e3'::uuid),
      ('admin inativo',                '81000000-0000-0000-0000-0000000000a4'::uuid),
      ('cliente',                      '81000000-0000-0000-0000-0000000000c1'::uuid),
      ('empreiteiro',                  '81000000-0000-0000-0000-0000000000b1'::uuid),
      ('fornecedor',                   '81000000-0000-0000-0000-0000000000f1'::uuid),
      ('usuário sem perfil',           '81000000-0000-0000-0000-00000000ffff'::uuid)
    ) as t(descricao, id)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caso.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform 1 from public.listar_contas_internas();
      execute 'reset role';
      raise exception 'FALHA: % conseguiu listar as contas internas', v_caso.descricao;
    exception when insufficient_privilege then
      execute 'reset role';
      if sqlerrm not like '%administradores%' then
        raise exception 'FALHA: % recusado por outro motivo: %', v_caso.descricao, sqlerrm;
      end if;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- salvar_permissoes_equipe como admin (a1): ordem das gravações, linha mantida, auditoria, recusas.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"81000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_a1 constant uuid := '81000000-0000-0000-0000-0000000000a1';
  v_e5 constant uuid := '81000000-0000-0000-0000-0000000000e5';
  v_e6 constant uuid := '81000000-0000-0000-0000-0000000000e6';
  v_ids uuid[];
  v_em timestamptz[];
  v_total bigint;
  v_caso record;
  v_alvo uuid;
  v_lista text[];
  v_i integer;
begin
  -- Concede em ordem qualquer: site.editar antes de site.ver.
  perform public.salvar_permissoes_equipe(v_e5, array['site.editar', 'financeiro.ver', 'site.ver']);
  if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e5), array['site.ver', 'site.editar', 'financeiro.ver']) is not true then
    raise exception 'FALHA: o e5 deveria ter site.ver, site.editar e financeiro.ver, tem %', public.e8_teste_permissoes_de(v_e5);
  end if;
  if (select count(*) from public.equipe_permissoes e where e.profile_id = v_e5 and e.concedida_por = v_a1) <> 3 then
    raise exception 'FALHA: concedida_por das 3 linhas deveria ser o admin da sessão';
  end if;
  if public.e8_teste_auditoria(v_e5, 'INSERT') <> 3 or public.e8_teste_auditoria(v_e5, 'DELETE') <> 0 then
    raise exception 'FALHA: a primeira gravação deveria gerar 3 auditorias de INSERT e nenhuma de DELETE';
  end if;

  -- Linha mantida: mesmo id, mesma concedida_em, sem auditoria; sai financeiro.ver, entra contatos.ver.
  select array_agg(e.id order by e.permissao), array_agg(e.concedida_em order by e.permissao) into v_ids, v_em
    from public.equipe_permissoes e where e.profile_id = v_e5 and e.permissao in ('site.ver', 'site.editar');
  perform public.salvar_permissoes_equipe(v_e5, array['contatos.ver', 'site.ver', 'site.editar']);
  if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e5), array['site.ver', 'site.editar', 'contatos.ver']) is not true then
    raise exception 'FALHA: o e5 deveria ter site.ver, site.editar e contatos.ver, tem %', public.e8_teste_permissoes_de(v_e5);
  end if;
  if (select array_agg(e.id order by e.permissao) from public.equipe_permissoes e
       where e.profile_id = v_e5 and e.permissao in ('site.ver', 'site.editar')) is distinct from v_ids then
    raise exception 'FALHA: as linhas mantidas foram apagadas e regravadas (id mudou)';
  end if;
  if (select array_agg(e.concedida_em order by e.permissao) from public.equipe_permissoes e
       where e.profile_id = v_e5 and e.permissao in ('site.ver', 'site.editar')) is distinct from v_em then
    raise exception 'FALHA: a concedida_em das linhas mantidas mudou';
  end if;
  if public.e8_teste_auditoria(v_e5, 'INSERT') <> 4 or public.e8_teste_auditoria(v_e5, 'DELETE') <> 1 then
    raise exception 'FALHA: a troca deveria gerar só 1 INSERT e 1 DELETE novos (linhas mantidas não geram auditoria)';
  end if;

  -- Mesma lista de novo: nada muda, nada é auditado.
  v_total := public.e8_teste_auditoria_total();
  perform public.salvar_permissoes_equipe(v_e5, array['site.ver', 'contatos.ver', 'site.editar']);
  if public.e8_teste_auditoria_total() <> v_total then
    raise exception 'FALHA: salvar a mesma lista gerou auditoria';
  end if;
  if (select array_agg(e.id order by e.permissao) from public.equipe_permissoes e
       where e.profile_id = v_e5 and e.permissao in ('site.ver', 'site.editar')) is distinct from v_ids then
    raise exception 'FALHA: salvar a mesma lista regravou linhas';
  end if;

  -- Remove ver e editar juntos (o dependente sai antes do pré-requisito).
  perform public.salvar_permissoes_equipe(v_e5, array['contatos.ver']);
  if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e5), array['contatos.ver']) is not true then
    raise exception 'FALHA: o e5 deveria ter só contatos.ver, tem %', public.e8_teste_permissoes_de(v_e5);
  end if;
  if public.e8_teste_auditoria(v_e5, 'INSERT') <> 4 or public.e8_teste_auditoria(v_e5, 'DELETE') <> 3 then
    raise exception 'FALHA: remover site.ver e site.editar deveria gerar 2 DELETE';
  end if;

  -- Troca o conjunto inteiro, em ordem embaralhada, com pré-requisitos e dependentes.
  perform public.salvar_permissoes_equipe(v_e5, array['servidor.regras', 'obras.aprovar', 'documentos.liberar',
                                                       'documentos.ver', 'obras.ver', 'empreendimentos.ver']);
  if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e5),
       array['servidor.regras', 'obras.aprovar', 'documentos.liberar', 'documentos.ver', 'obras.ver', 'empreendimentos.ver']) is not true then
    raise exception 'FALHA: o e5 deveria ter o novo conjunto de 6, tem %', public.e8_teste_permissoes_de(v_e5);
  end if;
  if public.e8_teste_auditoria(v_e5, 'INSERT') <> 10 or public.e8_teste_auditoria(v_e5, 'DELETE') <> 4 then
    raise exception 'FALHA: trocar o conjunto deveria gerar 6 INSERT e 1 DELETE (contatos.ver)';
  end if;

  -- Encolhe tirando pré-requisitos junto com os dependentes na mesma chamada.
  perform public.salvar_permissoes_equipe(v_e5, array['documentos.ver', 'obras.ver']);
  if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e5), array['documentos.ver', 'obras.ver']) is not true then
    raise exception 'FALHA: o e5 deveria ter documentos.ver e obras.ver, tem %', public.e8_teste_permissoes_de(v_e5);
  end if;
  if public.e8_teste_auditoria(v_e5, 'INSERT') <> 10 or public.e8_teste_auditoria(v_e5, 'DELETE') <> 8 then
    raise exception 'FALHA: encolher o conjunto deveria gerar 4 DELETE';
  end if;

  -- Itens repetidos na lista valem uma vez.
  perform public.salvar_permissoes_equipe(v_e5, array['site.ver', 'site.ver', 'obras.ver', 'documentos.ver']);
  if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e5), array['site.ver', 'obras.ver', 'documentos.ver']) is not true
     or public.e8_teste_auditoria(v_e5, 'INSERT') <> 11 then
    raise exception 'FALHA: lista com item repetido deveria acrescentar só site.ver';
  end if;

  -- Lista vazia tira tudo.
  perform public.salvar_permissoes_equipe(v_e5, array[]::text[]);
  if cardinality(public.e8_teste_permissoes_de(v_e5)) <> 0
     or public.e8_teste_auditoria(v_e5, 'INSERT') <> 11 or public.e8_teste_auditoria(v_e5, 'DELETE') <> 11 then
    raise exception 'FALHA: lista vazia deveria esvaziar o e5 e gerar 3 DELETE (total 11 e 11)';
  end if;

  -- Recusas: nada é gravado, nem a remoção do que já estava lá.
  perform public.salvar_permissoes_equipe(v_e6, array['site.ver']);
  v_total := public.e8_teste_auditoria_total();
  for v_caso in
    select * from (values
      ('dependente sem pré-requisito',            array['site.editar']::text[]),
      ('pré-requisito de outro módulo',           array['site.ver', 'financeiro.editar']::text[]),
      ('servidor.regras sem empreendimentos.ver', array['site.ver', 'servidor.regras']::text[]),
      ('permissão fora do catálogo',              array['nao.existe']::text[]),
      ('fora do catálogo junto de uma válida',    array['site.ver', 'Site.ver']::text[]),
      ('item nulo',                               array['site.ver', null]::text[]),
      ('lista nula',                              null::text[])
    ) as t(descricao, lista)
  loop
    begin
      perform public.salvar_permissoes_equipe(v_e6, v_caso.lista);
      raise exception 'FALHA: lista recusável aceita (%)', v_caso.descricao;
    exception when check_violation then
      null;
    end;
    if public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e6), array['site.ver']) is not true then
      raise exception 'FALHA: a recusa de "%" mexeu nas permissões do e6: %', v_caso.descricao, public.e8_teste_permissoes_de(v_e6);
    end if;
    if public.e8_teste_auditoria_total() <> v_total then
      raise exception 'FALHA: a recusa de "%" gerou auditoria', v_caso.descricao;
    end if;
  end loop;

  -- Alvo que não é equipe (cliente, empreiteiro, fornecedor, admin, a própria conta do admin, perfil que não existe),
  -- com lista cheia e com lista vazia.
  foreach v_alvo in array array[
    '81000000-0000-0000-0000-0000000000c1', '81000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-0000000000f1',
    '81000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-0000000000a2', '81000000-0000-0000-0000-0000000000a4',
    '81000000-0000-0000-0000-00000000ffff'
  ]::uuid[] loop
    for v_i in 1..2 loop
      v_lista := case v_i when 1 then array['site.ver'] else array[]::text[] end;
      begin
        perform public.salvar_permissoes_equipe(v_alvo, v_lista);
        raise exception 'FALHA: o alvo % (lista %) foi aceito', v_alvo, v_lista;
      exception when check_violation then
        if sqlerrm not like '%contas da equipe%' then
          raise exception 'FALHA: alvo % recusado por outro motivo: %', v_alvo, sqlerrm;
        end if;
      end;
    end loop;
  end loop;
  if public.e8_teste_auditoria_total() <> v_total
     or exists (select 1 from public.equipe_permissoes e
                 where e.profile_id in ('81000000-0000-0000-0000-0000000000c1', '81000000-0000-0000-0000-0000000000b1',
                                        '81000000-0000-0000-0000-0000000000f1', '81000000-0000-0000-0000-0000000000a1',
                                        '81000000-0000-0000-0000-0000000000a2', '81000000-0000-0000-0000-0000000000a4')) then
    raise exception 'FALHA: os alvos recusados deixaram linha ou auditoria';
  end if;
end $$;

-- Equipe com as 22 permissões e as demais contas sem direito: recusadas, inclusive sobre a própria conta.
reset role;

do $$
declare
  v_e5 constant uuid := '81000000-0000-0000-0000-0000000000e5';
  v_e6 constant uuid := '81000000-0000-0000-0000-0000000000e6';
  v_caso record;
  v_alvo uuid;
  v_lista text[];
  v_i integer;
  v_j integer;
  v_total bigint := public.e8_teste_auditoria_total();
begin
  for v_caso in
    select * from (values
      ('equipe com as 22 permissões',  '81000000-0000-0000-0000-0000000000e4'::uuid),
      ('equipe com 3 permissões',      '81000000-0000-0000-0000-0000000000e1'::uuid),
      ('equipe inativa',               '81000000-0000-0000-0000-0000000000e2'::uuid),
      ('equipe com troca pendente',    '81000000-0000-0000-0000-0000000000e3'::uuid),
      ('admin inativo',                '81000000-0000-0000-0000-0000000000a4'::uuid),
      ('cliente',                      '81000000-0000-0000-0000-0000000000c1'::uuid),
      ('empreiteiro',                  '81000000-0000-0000-0000-0000000000b1'::uuid),
      ('fornecedor',                   '81000000-0000-0000-0000-0000000000f1'::uuid)
    ) as t(descricao, id)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caso.id, 'role', 'authenticated')::text, true);
    for v_i in 1..2 loop
      v_alvo := case v_i when 1 then v_e5 else v_caso.id end;
      for v_j in 1..2 loop
        v_lista := case v_j when 1 then array['site.ver'] else array[]::text[] end;
        execute 'set local role authenticated';
        begin
          perform public.salvar_permissoes_equipe(v_alvo, v_lista);
          execute 'reset role';
          raise exception 'FALHA: % conseguiu salvar permissões em % (lista %)', v_caso.descricao, v_alvo, v_lista;
        exception when insufficient_privilege then
          execute 'reset role';
          if sqlerrm not like '%administradores%' then
            raise exception 'FALHA: % recusado por outro motivo: %', v_caso.descricao, sqlerrm;
          end if;
        end;
      end loop;
    end loop;
  end loop;

  if cardinality(public.e8_teste_permissoes_de(v_e5)) <> 0
     or cardinality(public.e8_teste_permissoes_de('81000000-0000-0000-0000-0000000000e4')) <> 24
     or cardinality(public.e8_teste_permissoes_de('81000000-0000-0000-0000-0000000000e1')) <> 3
     or public.e8_teste_iguais(public.e8_teste_permissoes_de(v_e6), array['site.ver']) is not true then
    raise exception 'FALHA: as tentativas recusadas mudaram permissões';
  end if;
  if public.e8_teste_auditoria_total() <> v_total then
    raise exception 'FALHA: as tentativas recusadas geraram auditoria';
  end if;
end $$;

-- Toda concessão e remoção feita pelo admin tem o admin como ator.
do $$
begin
  if public.e8_teste_auditoria_de_outro_ator('81000000-0000-0000-0000-0000000000e5', '81000000-0000-0000-0000-0000000000a1') <> 0
     or public.e8_teste_auditoria_de_outro_ator('81000000-0000-0000-0000-0000000000e6', '81000000-0000-0000-0000-0000000000a1') <> 0 then
    raise exception 'FALHA: toda auditoria do e5 e do e6 deveria ter o admin a1 como ator';
  end if;
  if public.e8_teste_auditoria('81000000-0000-0000-0000-0000000000e5', 'INSERT') <> 11
     or public.e8_teste_auditoria('81000000-0000-0000-0000-0000000000e5', 'DELETE') <> 11
     or public.e8_teste_auditoria('81000000-0000-0000-0000-0000000000e6', 'INSERT') <> 1 then
    raise exception 'FALHA: contagem final da auditoria do e5 (11 e 11) e do e6 (1 INSERT) errada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Anônimo: não executa nenhuma das duas.
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform 1 from public.listar_contas_internas();
    raise exception 'FALHA: anon conseguiu executar listar_contas_internas';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.salvar_permissoes_equipe('81000000-0000-0000-0000-0000000000e5', array['site.ver']);
    raise exception 'FALHA: anon conseguiu executar salvar_permissoes_equipe';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: contas internas da Etapa 8 (último admin, listar_contas_internas, salvar_permissoes_equipe) passaram nos testes' as resultado;

rollback;
