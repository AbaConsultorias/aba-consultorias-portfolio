-- Testes da Etapa 8 — permissões de exclusão (empreendimentos.excluir e fornecedores.excluir; decisão do dono em 09/11 sobre R10 e R11).
-- Cobre: o DELETE de empreendimento, fornecedor e contrato de fornecedor por permissão; fornecedor_documentos continua só do
-- admin; pré-requisito na concessão e na remoção; empreendimento_tem_vinculos() (devolve verdadeiro para quem não enxerga o
-- que há vinculado) e a trava de vínculos dentro da própria política de DELETE de empreendimentos.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo 20261109100000_etapa8_permissoes_exclusao.sql, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_permissoes_exclusao.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina em ROLLBACK. Se alguma verificação
-- falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O banco de produção tem dados reais: tudo usa ids da fixture (prefixo 85000000-) e nenhuma verificação depende de tabela vazia.
--
-- Contas (ids 85000000-0000-0000-0000-0000000000xx): admin (a1); equipe: em_e (e1, empreendimentos.ver+editar),
--   em_x (e2, +excluir), fo_e (e3, fornecedores.ver+editar), fo_x (e4, +excluir), em_v (e5, empreendimentos.ver),
--   fo_v (e6, fornecedores.ver); cliente c1.

begin;

-- ---------------------------------------------------------------------------
-- Ajudantes (existem só dentro da transação; mesmo desenho dos outros testes da etapa 8).
-- ---------------------------------------------------------------------------

create table public.t8_contas (
  chave text primary key,
  id uuid not null
);

create function public.t8_conta(
  p_chave text, p_id uuid, p_papel public.papel_usuario,
  p_perms text[] default '{}'
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
  values (p_id, p_papel, 'T8 ' || p_chave, true, false);
  insert into public.t8_contas (chave, id) values (p_chave, p_id);
  foreach v_permissao in array p_perms loop
    insert into public.equipe_permissoes (profile_id, permissao) values (p_id, v_permissao);
  end loop;
end;
$$;

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
  else
    select c.id into v_id from public.t8_contas c where c.chave = p_chave;
    if v_id is null then
      raise exception 'FALHA: conta de teste % não existe', p_chave;
    end if;
    v_papel := 'authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  end if;
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
  -- Sem limpar, a fixture gravada depois herdaria esta sessão e o trigger de equipe_permissoes recusaria.
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Uma conta só: tem que conseguir e afetar p_linhas linhas.
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

-- Uma conta só: tem que ser recusada (erro de permissão ou nenhuma linha afetada).
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

-- Executa uma consulta que devolve boolean (ou uma contagem) como a conta e devolve 1/0, ou o código do erro.
create function public.t8_numero(p_chave text, p_sql text)
returns text
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.t8_roda(p_chave, p_sql, true);
  if r.estado <> '00000' then
    return 'erro ' || r.estado;
  end if;
  return r.valor::text;
end;
$$;

create function public.t8_exige(p_obtido text, p_esperado text, p_msg text)
returns void
language plpgsql
as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHA: % — esperado [%], obtido [%]', p_msg, p_esperado, p_obtido;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture.
-- ---------------------------------------------------------------------------

select public.t8_conta('admin', '85000000-0000-0000-0000-0000000000a1', 'admin');
select public.t8_conta('em_e', '85000000-0000-0000-0000-0000000000e1', 'equipe', array['empreendimentos.ver', 'empreendimentos.editar']);
select public.t8_conta('em_x', '85000000-0000-0000-0000-0000000000e2', 'equipe', array['empreendimentos.ver', 'empreendimentos.editar', 'empreendimentos.excluir']);
select public.t8_conta('fo_e', '85000000-0000-0000-0000-0000000000e3', 'equipe', array['fornecedores.ver', 'fornecedores.editar']);
select public.t8_conta('fo_x', '85000000-0000-0000-0000-0000000000e4', 'equipe', array['fornecedores.ver', 'fornecedores.editar', 'fornecedores.excluir']);
select public.t8_conta('em_v', '85000000-0000-0000-0000-0000000000e5', 'equipe', array['empreendimentos.ver']);
select public.t8_conta('fo_v', '85000000-0000-0000-0000-0000000000e6', 'equipe', array['fornecedores.ver']);
select public.t8_conta('sv', '85000000-0000-0000-0000-0000000000e7', 'equipe');
select public.t8_conta('c1', '85000000-0000-0000-0000-0000000000c1', 'cliente');

-- ---------------------------------------------------------------------------
-- 1. Estrutura: catálogo, função de vínculos e políticas de DELETE.
-- ---------------------------------------------------------------------------

do $$
begin
  if not ('empreendimentos.excluir' = any (public.catalogo_permissoes()) and 'fornecedores.excluir' = any (public.catalogo_permissoes())) then
    raise exception 'FALHA: o catálogo não tem as duas permissões de exclusão';
  end if;
  if public.prerequisitos_permissao('empreendimentos.excluir') is distinct from array['empreendimentos.editar']
     or public.prerequisitos_permissao('fornecedores.excluir') is distinct from array['fornecedores.editar'] then
    raise exception 'FALHA: o pré-requisito de cada exclusão deveria ser a edição da mesma área';
  end if;

  -- Função de vínculos: security definer, search_path vazio, sem execute para anon e com execute para authenticated.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.empreendimento_tem_vinculos(uuid)'::regprocedure
      and p.prosecdef
      and p.provolatile = 's'
      and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))
  then
    raise exception 'FALHA: empreendimento_tem_vinculos deveria ser security definer, stable e com search_path vazio';
  end if;
  -- anon herda de public: se anon não executa, o revoke de public valeu.
  if has_function_privilege('anon', 'public.empreendimento_tem_vinculos(uuid)', 'execute') then
    raise exception 'FALHA: anon não deveria executar empreendimento_tem_vinculos';
  end if;
  if not has_function_privilege('authenticated', 'public.empreendimento_tem_vinculos(uuid)', 'execute') then
    raise exception 'FALHA: authenticated deveria executar empreendimento_tem_vinculos';
  end if;

  -- Cada tabela tem exatamente uma política de DELETE; fornecedor_documentos segue com e_admin().
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'empreendimentos' and cmd = 'DELETE'
        and qual like '%empreendimentos.excluir%') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'empreendimentos' and cmd = 'DELETE') <> 1 then
    raise exception 'FALHA: empreendimentos deveria ter uma única política de DELETE, por empreendimentos.excluir';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fornecedores' and cmd = 'DELETE'
        and qual like '%fornecedores.excluir%') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fornecedores' and cmd = 'DELETE') <> 1 then
    raise exception 'FALHA: fornecedores deveria ter uma única política de DELETE, por fornecedores.excluir';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fornecedor_contratos' and cmd = 'DELETE'
        and qual like '%fornecedores.excluir%') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fornecedor_contratos' and cmd = 'DELETE') <> 1 then
    raise exception 'FALHA: fornecedor_contratos deveria ter uma única política de DELETE, por fornecedores.excluir';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fornecedor_documentos' and cmd = 'DELETE'
        and qual like '%e_admin%') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fornecedor_documentos' and cmd = 'DELETE') <> 1 then
    raise exception 'FALHA: fornecedor_documentos deveria seguir com uma única política de DELETE, só do admin';
  end if;
end $$;

-- tem_permissao: admin sempre; equipe só com a linha; ninguém mais.
select public.t8_exige(public.t8_numero('admin', $q$select case when public.tem_permissao('empreendimentos.excluir') then 1 else 0 end$q$), '1', 'admin tem empreendimentos.excluir');
select public.t8_exige(public.t8_numero('admin', $q$select case when public.tem_permissao('fornecedores.excluir') then 1 else 0 end$q$), '1', 'admin tem fornecedores.excluir');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.tem_permissao('empreendimentos.excluir') then 1 else 0 end$q$), '1', 'em_x tem empreendimentos.excluir');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.tem_permissao('fornecedores.excluir') then 1 else 0 end$q$), '0', 'em_x não tem fornecedores.excluir');
select public.t8_exige(public.t8_numero('em_e', $q$select case when public.tem_permissao('empreendimentos.excluir') then 1 else 0 end$q$), '0', 'em_e não tem empreendimentos.excluir');
select public.t8_exige(public.t8_numero('fo_x', $q$select case when public.tem_permissao('fornecedores.excluir') then 1 else 0 end$q$), '1', 'fo_x tem fornecedores.excluir');
select public.t8_exige(public.t8_numero('fo_e', $q$select case when public.tem_permissao('fornecedores.excluir') then 1 else 0 end$q$), '0', 'fo_e não tem fornecedores.excluir');

-- ---------------------------------------------------------------------------
-- 2. Conceder: a exclusão exige a edição da mesma área, e só o admin concede.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('85000000-0000-0000-0000-0000000000e5', 'empreendimentos.excluir');
    raise exception 'FALHA: empreendimentos.excluir aceito sem empreendimentos.editar';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('85000000-0000-0000-0000-0000000000e6', 'fornecedores.excluir');
    raise exception 'FALHA: fornecedores.excluir aceito sem fornecedores.editar';
  exception when check_violation then
    null;
  end;
  begin
    -- Só ver não basta; o pré-requisito é a edição, não a leitura.
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('85000000-0000-0000-0000-0000000000e3', 'empreendimentos.excluir');
    raise exception 'FALHA: empreendimentos.excluir aceito para conta que só edita fornecedores';
  exception when check_violation then
    null;
  end;
  if exists (select 1 from public.equipe_permissoes
              where profile_id in ('85000000-0000-0000-0000-0000000000e5', '85000000-0000-0000-0000-0000000000e6')
                and permissao like '%.excluir') then
    raise exception 'FALHA: tentativas recusadas deixaram linha de exclusão';
  end if;

  -- Remover a edição com a exclusão presente é recusado.
  begin
    delete from public.equipe_permissoes
     where profile_id = '85000000-0000-0000-0000-0000000000e2' and permissao = 'empreendimentos.editar';
    raise exception 'FALHA: empreendimentos.editar apagado com empreendimentos.excluir presente';
  exception when check_violation then
    null;
  end;
  begin
    delete from public.equipe_permissoes
     where profile_id = '85000000-0000-0000-0000-0000000000e4' and permissao = 'fornecedores.editar';
    raise exception 'FALHA: fornecedores.editar apagado com fornecedores.excluir presente';
  exception when check_violation then
    null;
  end;
end $$;

-- A equipe não concede a ninguém, nem a si mesma, nem com a própria exclusão.
select public.t8_nao_pode('em_x',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('85000000-0000-0000-0000-0000000000e1', 'empreendimentos.excluir')$q$,
  'equipe com excluir concedeu a outra conta');
select public.t8_nao_pode('fo_x',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('85000000-0000-0000-0000-0000000000e3', 'fornecedores.excluir')$q$,
  'equipe com excluir concedeu a outra conta (fornecedores)');

-- salvar_permissoes_equipe grava e remove a cadeia de três níveis (ver, editar, excluir) sem depender da ordem das linhas.
select public.t8_pode('admin',
  $q$select public.salvar_permissoes_equipe('85000000-0000-0000-0000-0000000000e7',
       array['empreendimentos.excluir', 'fornecedores.excluir', 'empreendimentos.editar', 'fornecedores.editar', 'empreendimentos.ver', 'fornecedores.ver', 'site.ver'])$q$,
  'salvar a cadeia inteira de uma vez');
select public.t8_exige(
  (select string_agg(permissao, ',' order by permissao) from public.equipe_permissoes where profile_id = '85000000-0000-0000-0000-0000000000e7'),
  'empreendimentos.editar,empreendimentos.excluir,empreendimentos.ver,fornecedores.editar,fornecedores.excluir,fornecedores.ver,site.ver',
  'cadeia gravada por salvar_permissoes_equipe');
select public.t8_pode('admin',
  $q$select public.salvar_permissoes_equipe('85000000-0000-0000-0000-0000000000e7', array['empreendimentos.ver', 'fornecedores.ver', 'fornecedores.editar'])$q$,
  'remover excluir e editar na mesma chamada');
select public.t8_exige(
  (select string_agg(permissao, ',' order by permissao) from public.equipe_permissoes where profile_id = '85000000-0000-0000-0000-0000000000e7'),
  'empreendimentos.ver,fornecedores.editar,fornecedores.ver',
  'cadeia depois de remover');
select public.t8_nao_pode('admin',
  $q$select public.salvar_permissoes_equipe('85000000-0000-0000-0000-0000000000e7', array['empreendimentos.ver', 'empreendimentos.excluir'])$q$,
  'salvar excluir sem editar');
select public.t8_pode('admin',
  $q$select public.salvar_permissoes_equipe('85000000-0000-0000-0000-0000000000e7', array[]::text[])$q$,
  'esvaziar a conta com a cadeia presente');

-- ---------------------------------------------------------------------------
-- 3. Empreendimento sem vínculos: só quem tem empreendimentos.excluir (e o admin) apaga.
-- ---------------------------------------------------------------------------

insert into public.empreendimentos (id, nome)
values
  ('85000000-0000-0000-0000-000000000e01', 'Empreendimento T8x 1'),
  ('85000000-0000-0000-0000-000000000e02', 'Empreendimento T8x 2'),
  ('85000000-0000-0000-0000-000000000e03', 'Empreendimento T8x 3');

select public.t8_nao_pode('em_e', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e01'$q$, 'editar sem excluir apagou empreendimento');
select public.t8_nao_pode('em_v', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e01'$q$, 'só ver apagou empreendimento');
select public.t8_nao_pode('fo_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e01'$q$, 'fornecedores.excluir apagou empreendimento');
select public.t8_nao_pode('c1', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e01'$q$, 'cliente apagou empreendimento');
select public.t8_nao_pode('anon', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e01'$q$, 'anon apagou empreendimento');

do $$
begin
  if (select count(*) from public.empreendimentos where id::text like '85000000-%') <> 3 then
    raise exception 'FALHA: as tentativas recusadas apagaram empreendimento';
  end if;
end $$;

select public.t8_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e01'$q$, 'excluir apaga empreendimento sem vínculos');
select public.t8_pode('admin', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e02'$q$, 'admin apaga empreendimento');

-- O admin concede a exclusão e a conta passa a apagar; ao remover, deixa de apagar.
select public.t8_pode('admin',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('85000000-0000-0000-0000-0000000000e1', 'empreendimentos.excluir')$q$,
  'admin concede empreendimentos.excluir');
select public.t8_pode('em_e', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e03'$q$, 'conta com a exclusão concedida apaga empreendimento');
insert into public.empreendimentos (id, nome) values ('85000000-0000-0000-0000-000000000e04', 'Empreendimento T8x 4');
select public.t8_pode('admin',
  $q$delete from public.equipe_permissoes where profile_id = '85000000-0000-0000-0000-0000000000e1' and permissao = 'empreendimentos.excluir'$q$,
  'admin remove empreendimentos.excluir');
select public.t8_nao_pode('em_e', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e04'$q$, 'conta sem a exclusão apagou empreendimento');

do $$
begin
  if exists (select 1 from public.empreendimentos where id in ('85000000-0000-0000-0000-000000000e01', '85000000-0000-0000-0000-000000000e02', '85000000-0000-0000-0000-000000000e03'))
     or not exists (select 1 from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e04') then
    raise exception 'FALHA: o estado dos empreendimentos depois dos DELETE não é o esperado';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Vínculos: a função devolve verdadeiro mesmo para quem não enxerga o que está vinculado,
--    e a política de DELETE recusa a equipe nesses casos (a cascata ignoraria o RLS das filhas).
-- ---------------------------------------------------------------------------

insert into public.empreendimentos (id, nome)
values
  ('85000000-0000-0000-0000-000000000e10', 'T8x com documento'),
  ('85000000-0000-0000-0000-000000000e11', 'T8x com atualização'),
  ('85000000-0000-0000-0000-000000000e12', 'T8x com cliente vinculado'),
  ('85000000-0000-0000-0000-000000000e13', 'T8x com regra de pasta'),
  ('85000000-0000-0000-0000-000000000e14', 'T8x com contrato de fornecedor'),
  ('85000000-0000-0000-0000-000000000e15', 'T8x sem nada'),
  ('85000000-0000-0000-0000-000000000e16', 'T8x sem nada 2');

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho)
values ('85000000-0000-0000-0000-00000000d001', '85000000-0000-0000-0000-000000000e10', 'Documento T8x',
        '85000000-0000-0000-0000-000000000e10/d001.pdf', 'application/pdf', 100);

insert into public.atualizacoes (id, empreendimento_id, titulo)
values ('85000000-0000-0000-0000-00000000b001', '85000000-0000-0000-0000-000000000e11', 'Atualização T8x');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('85000000-0000-0000-0000-000000000e12', '85000000-0000-0000-0000-0000000000c1');

insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo)
values ('85000000-0000-0000-0000-00000000f0a1', '85000000-0000-0000-0000-000000000e13', 'REGRA T8X', 'contratos');

insert into public.fornecedores (id, razao_social)
values ('85000000-0000-0000-0000-00000000f001', 'Fornecedor T8x vinculado');

insert into public.fornecedor_contratos (id, fornecedor_id, empreendimento_id, titulo, storage_path, mime, tamanho)
values ('85000000-0000-0000-0000-00000000c001', '85000000-0000-0000-0000-00000000f001', '85000000-0000-0000-0000-000000000e14',
        'Contrato T8x', '85000000-0000-0000-0000-00000000f001/contratos/c001.pdf', 'application/pdf', 100);

-- em_x não enxerga o que está vinculado (sem documentos.ver, atualizacoes.ver, clientes.ver nem fornecedores.ver).
select public.t8_exige(public.t8_numero('em_x', $q$select count(*) from public.documentos where empreendimento_id = '85000000-0000-0000-0000-000000000e10'$q$), '0', 'em_x enxerga documento');
select public.t8_exige(public.t8_numero('em_x', $q$select count(*) from public.atualizacoes where empreendimento_id = '85000000-0000-0000-0000-000000000e11'$q$), '0', 'em_x enxerga atualização');
select public.t8_exige(public.t8_numero('em_x', $q$select count(*) from public.empreendimento_clientes where empreendimento_id = '85000000-0000-0000-0000-000000000e12'$q$), '0', 'em_x enxerga vínculo de cliente');
select public.t8_exige(public.t8_numero('em_x', $q$select count(*) from public.fornecedor_contratos where empreendimento_id = '85000000-0000-0000-0000-000000000e14'$q$), '0', 'em_x enxerga contrato de fornecedor');

-- ...e mesmo assim a função diz que há vínculo.
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e10') then 1 else 0 end$q$), '1', 'em_x: vínculo com documento escondido');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e11') then 1 else 0 end$q$), '1', 'em_x: vínculo com atualização escondida');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e12') then 1 else 0 end$q$), '1', 'em_x: vínculo com cliente escondido');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e13') then 1 else 0 end$q$), '1', 'em_x: regra de pasta escondida');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e14') then 1 else 0 end$q$), '1', 'em_x: contrato de fornecedor escondido');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e15') then 1 else 0 end$q$), '0', 'em_x: empreendimento sem nada');
select public.t8_exige(public.t8_numero('em_x', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-0000000000ff') then 1 else 0 end$q$), '0', 'em_x: empreendimento que não existe');

-- Admin: a checagem é a de sempre (documentos, atualizações, projetos, obras, financeiro); cliente vinculado e regra de pasta
-- seguem sendo apagados em cascata por ele.
select public.t8_exige(public.t8_numero('admin', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e10') then 1 else 0 end$q$), '1', 'admin: documento');
select public.t8_exige(public.t8_numero('admin', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e11') then 1 else 0 end$q$), '1', 'admin: atualização');
select public.t8_exige(public.t8_numero('admin', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e12') then 1 else 0 end$q$), '0', 'admin: cliente vinculado');
select public.t8_exige(public.t8_numero('admin', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e13') then 1 else 0 end$q$), '0', 'admin: regra de pasta');
select public.t8_exige(public.t8_numero('admin', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e14') then 1 else 0 end$q$), '0', 'admin: contrato de fornecedor');

-- Sem a permissão (ou sem papel) a função não revela nada: devolve falso; anon nem executa.
select public.t8_exige(public.t8_numero('em_e', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e10') then 1 else 0 end$q$), '0', 'em_e (sem excluir) não descobre vínculo');
select public.t8_exige(public.t8_numero('c1', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e10') then 1 else 0 end$q$), '0', 'cliente não descobre vínculo');
select public.t8_exige(public.t8_numero('anon', $q$select case when public.empreendimento_tem_vinculos('85000000-0000-0000-0000-000000000e10') then 1 else 0 end$q$), 'erro 42501', 'anon não executa a função');

-- Política de DELETE: a equipe com a exclusão não apaga empreendimento com vínculo, visível ou não.
select public.t8_nao_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e10'$q$, 'equipe apagou empreendimento com documento');
select public.t8_nao_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e11'$q$, 'equipe apagou empreendimento com atualização escondida (cascata)');
select public.t8_nao_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e12'$q$, 'equipe apagou empreendimento com cliente vinculado escondido (cascata)');
select public.t8_nao_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e13'$q$, 'equipe apagou empreendimento com regra de pasta (cascata)');
select public.t8_nao_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e14'$q$, 'equipe apagou empreendimento com contrato de fornecedor (set null)');

do $$
begin
  if (select count(*) from public.empreendimentos where id::text between '85000000-0000-0000-0000-000000000e10' and '85000000-0000-0000-0000-000000000e16') <> 7
     or not exists (select 1 from public.atualizacoes where id = '85000000-0000-0000-0000-00000000b001')
     or not exists (select 1 from public.empreendimento_clientes where empreendimento_id = '85000000-0000-0000-0000-000000000e12')
     or not exists (select 1 from public.pasta_regras where id = '85000000-0000-0000-0000-00000000f0a1')
     or (select empreendimento_id from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c001') is distinct from '85000000-0000-0000-0000-000000000e14'::uuid
  then
    raise exception 'FALHA: a equipe apagou ou alterou, em cascata, o que não enxerga';
  end if;
end $$;

-- Sem vínculos a equipe apaga; o admin segue apagando em cascata cliente vinculado e regra de pasta (como sempre).
select public.t8_pode('em_x', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e15'$q$, 'equipe apaga empreendimento sem nada vinculado');
select public.t8_pode('admin', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e12'$q$, 'admin apaga empreendimento com cliente vinculado');
select public.t8_pode('admin', $q$delete from public.empreendimentos where id = '85000000-0000-0000-0000-000000000e13'$q$, 'admin apaga empreendimento com regra de pasta');

-- ---------------------------------------------------------------------------
-- 5. Fornecedor, contrato e documento de fornecedor.
-- ---------------------------------------------------------------------------

insert into public.fornecedores (id, razao_social)
values
  ('85000000-0000-0000-0000-00000000f101', 'Fornecedor T8x 1'),
  ('85000000-0000-0000-0000-00000000f102', 'Fornecedor T8x 2'),
  ('85000000-0000-0000-0000-00000000f103', 'Fornecedor T8x 3');

insert into public.fornecedor_contratos (id, fornecedor_id, titulo, storage_path, mime, tamanho)
values
  ('85000000-0000-0000-0000-00000000c101', '85000000-0000-0000-0000-00000000f001', 'Contrato T8x 1', '85000000-0000-0000-0000-00000000f001/contratos/c101.pdf', 'application/pdf', 100),
  ('85000000-0000-0000-0000-00000000c102', '85000000-0000-0000-0000-00000000f001', 'Contrato T8x 2', '85000000-0000-0000-0000-00000000f001/contratos/c102.pdf', 'application/pdf', 100),
  ('85000000-0000-0000-0000-00000000c103', '85000000-0000-0000-0000-00000000f001', 'Contrato T8x 3', '85000000-0000-0000-0000-00000000f001/contratos/c103.pdf', 'application/pdf', 100);

insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
values
  ('85000000-0000-0000-0000-00000000d101', '85000000-0000-0000-0000-00000000f001', '85000000-0000-0000-0000-0000000000a1', 'certidao', 'Certidão T8x 1', '85000000-0000-0000-0000-00000000f001/documentos/d101.pdf', 'application/pdf', 100),
  ('85000000-0000-0000-0000-00000000d102', '85000000-0000-0000-0000-00000000f001', '85000000-0000-0000-0000-0000000000a1', 'certidao', 'Certidão T8x 2', '85000000-0000-0000-0000-00000000f001/documentos/d102.pdf', 'application/pdf', 100);

-- Sem a permissão: editar não apaga fornecedor nem contrato; excluir de empreendimentos não vale aqui.
select public.t8_nao_pode('fo_e', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f101'$q$, 'editar sem excluir apagou fornecedor');
select public.t8_nao_pode('fo_v', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f101'$q$, 'só ver apagou fornecedor');
select public.t8_nao_pode('em_x', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f101'$q$, 'empreendimentos.excluir apagou fornecedor');
select public.t8_nao_pode('c1', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f101'$q$, 'cliente apagou fornecedor');
select public.t8_nao_pode('anon', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f101'$q$, 'anon apagou fornecedor');
select public.t8_nao_pode('fo_e', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c101'$q$, 'editar sem excluir apagou contrato');
select public.t8_nao_pode('fo_v', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c101'$q$, 'só ver apagou contrato');
select public.t8_nao_pode('em_x', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c101'$q$, 'empreendimentos.excluir apagou contrato');
select public.t8_nao_pode('anon', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c101'$q$, 'anon apagou contrato');

-- Com a permissão: apaga fornecedor sem vínculos e contrato.
select public.t8_pode('fo_x', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f101'$q$, 'excluir apaga fornecedor sem vínculos');
select public.t8_pode('fo_x', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c101'$q$, 'excluir apaga contrato');
select public.t8_pode('admin', $q$delete from public.fornecedores where id = '85000000-0000-0000-0000-00000000f102'$q$, 'admin apaga fornecedor');
select public.t8_pode('admin', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c102'$q$, 'admin apaga contrato');

-- O admin concede a exclusão e a conta passa a apagar contrato.
select public.t8_pode('admin',
  $q$insert into public.equipe_permissoes (profile_id, permissao) values ('85000000-0000-0000-0000-0000000000e3', 'fornecedores.excluir')$q$,
  'admin concede fornecedores.excluir');
select public.t8_pode('fo_e', $q$delete from public.fornecedor_contratos where id = '85000000-0000-0000-0000-00000000c103'$q$, 'conta com a exclusão concedida apaga contrato');

-- fornecedor_documentos continua só do admin: nem fo_x, que tem fornecedores.excluir.
select public.t8_nao_pode('fo_x', $q$delete from public.fornecedor_documentos where id = '85000000-0000-0000-0000-00000000d101'$q$, 'fornecedores.excluir apagou documento de fornecedor');
select public.t8_nao_pode('fo_e', $q$delete from public.fornecedor_documentos where id = '85000000-0000-0000-0000-00000000d101'$q$, 'conta com a exclusão concedida apagou documento de fornecedor');
select public.t8_nao_pode('fo_v', $q$delete from public.fornecedor_documentos where id = '85000000-0000-0000-0000-00000000d101'$q$, 'só ver apagou documento de fornecedor');
select public.t8_nao_pode('anon', $q$delete from public.fornecedor_documentos where id = '85000000-0000-0000-0000-00000000d101'$q$, 'anon apagou documento de fornecedor');

do $$
begin
  if (select count(*) from public.fornecedor_documentos where id in ('85000000-0000-0000-0000-00000000d101', '85000000-0000-0000-0000-00000000d102')) <> 2 then
    raise exception 'FALHA: documento de fornecedor sumiu para quem não é admin';
  end if;
  if exists (select 1 from public.fornecedores where id in ('85000000-0000-0000-0000-00000000f101', '85000000-0000-0000-0000-00000000f102'))
     or not exists (select 1 from public.fornecedores where id = '85000000-0000-0000-0000-00000000f103')
     or exists (select 1 from public.fornecedor_contratos where id in ('85000000-0000-0000-0000-00000000c101', '85000000-0000-0000-0000-00000000c102', '85000000-0000-0000-0000-00000000c103')) then
    raise exception 'FALHA: o estado de fornecedores e contratos depois dos DELETE não é o esperado';
  end if;
end $$;

select public.t8_pode('admin', $q$delete from public.fornecedor_documentos where id = '85000000-0000-0000-0000-00000000d101'$q$, 'admin apaga documento de fornecedor');

select 'OK: empreendimentos.excluir e fornecedores.excluir liberam só o DELETE de empreendimento, fornecedor e contrato; fornecedor_documentos segue só do admin; a função de vínculos enxerga o que a conta não vê' as resultado;

rollback;
