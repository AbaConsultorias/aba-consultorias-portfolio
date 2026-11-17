-- Testes da ordem dos projetos: coluna projetos.ordem, criar_projeto_de_modelo, troca de pai e reordenar_projetos
-- (docs/DATABASE.md; migration 20261110110000_ordem_projetos.sql).
-- Como rodar (somente em banco de TESTE, nunca em produção):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ordem_projetos.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/ordem_projetos.sql)
-- Rode com o usuário postgres, depois de TODAS as migrations, inclusive 20261110110000_ordem_projetos.sql. Tudo
-- acontece dentro de uma transação que termina em ROLLBACK. Se alguma verificação falhar, o script para com
-- "FALHA: ..."; se chegar ao fim, o último SELECT imprime "OK". Há dados reais no banco: o teste só conta e mexe nas
-- fixtures próprias (ids 91000000-...).
-- O preenchimento da migration roda uma vez, sobre as linhas que já existiam; aqui a mesma instrução é repetida,
-- restrita à fixture, para conferir a regra (alfabética por irmãos, separada por empreendimento e por pai).
--
-- Fixture: empreendimento 1 (e001) com Alfa, Beta e Casa na raiz e Dado e Zeta sob Beta; empreendimento 2 (e002)
-- com P1..P4 na raiz e F1 e F2 sob P1 (inseridos fora de ordem); empreendimento 3 (e003) vazio.
-- Contas: admin, equipe com empreendimentos.ver + editar, equipe só com .ver, equipe sem nada e cliente do
-- empreendimento 2; mais anon.

begin;

create function public.tordem_exige_ok(p_sql text, p_msg text)
returns void
language plpgsql
as $$
begin
  execute p_sql;
exception when others then
  raise exception 'FALHA: % (erro %: %)', p_msg, sqlstate, sqlerrm;
end;
$$;

create function public.tordem_exige_erro(p_sql text, p_estados text[], p_msg text)
returns void
language plpgsql
as $$
declare
  v_estado text;
begin
  begin
    execute p_sql;
  exception when others then
    v_estado := sqlstate;
  end;

  if v_estado is null then
    raise exception 'FALHA: % (não deu erro)', p_msg;
  end if;
  if not (v_estado = any (p_estados)) then
    raise exception 'FALHA: % (erro % em vez de %)', p_msg, v_estado, p_estados;
  end if;
end;
$$;

-- Para UPDATE/DELETE: negado é erro 42501 ou nenhuma linha afetada (o RLS esconde a linha).
create function public.tordem_exige_negado(p_sql text, p_msg text)
returns void
language plpgsql
as $$
declare
  v_estado text;
  v_linhas bigint := 0;
begin
  begin
    execute p_sql;
    get diagnostics v_linhas = row_count;
  exception when others then
    v_estado := sqlstate;
  end;

  if v_estado is null and v_linhas > 0 then
    raise exception 'FALHA: %', p_msg;
  end if;
  if v_estado is not null and v_estado <> '42501' then
    raise exception 'FALHA: % (erro inesperado %)', p_msg, v_estado;
  end if;
end;
$$;

create function public.tordem_exige_linhas(p_sql text, p_esperado bigint, p_msg text)
returns void
language plpgsql
as $$
declare
  v_linhas bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_linhas = row_count;
  exception when others then
    raise exception 'FALHA: % (erro %: %)', p_msg, sqlstate, sqlerrm;
  end;

  if v_linhas <> p_esperado then
    raise exception 'FALHA: % (afetou % linhas, esperado %)', p_msg, v_linhas, p_esperado;
  end if;
end;
$$;

create function public.tordem_exige_conta(p_sql text, p_esperado bigint, p_msg text)
returns void
language plpgsql
as $$
declare
  v_conta bigint;
begin
  execute p_sql into v_conta;
  if v_conta <> p_esperado then
    raise exception 'FALHA: % (contou %, esperado %)', p_msg, v_conta, p_esperado;
  end if;
end;
$$;

-- Os irmãos (mesmo empreendimento e mesmo pai) saem exatamente nesta ordem e com ordem 0, 1, 2...
-- Leitura como postgres (sem RLS): chame depois de "reset role".
create function public.tordem_exige_grupo(p_empreendimento uuid, p_pai uuid, p_esperado uuid[], p_msg text)
returns void
language plpgsql
as $$
declare
  v_ids uuid[];
  v_ordens integer[];
  v_posicoes integer[];
begin
  select array_agg(p.id order by p.ordem, p.nome, p.id), array_agg(p.ordem order by p.ordem, p.nome, p.id)
    into v_ids, v_ordens
  from public.projetos p
  where p.empreendimento_id = p_empreendimento and p.projeto_pai_id is not distinct from p_pai;

  select array_agg(g - 1) into v_posicoes from generate_series(1, coalesce(cardinality(p_esperado), 0)) g;

  if v_ids is distinct from p_esperado then
    raise exception 'FALHA: % (ordem encontrada %, esperada %)', p_msg, v_ids, p_esperado;
  end if;
  if v_ordens is distinct from v_posicoes then
    raise exception 'FALHA: % (valores de ordem % em vez de %)', p_msg, v_ordens, v_posicoes;
  end if;
end;
$$;

grant execute on function public.tordem_exige_ok(text, text) to authenticated, anon;
grant execute on function public.tordem_exige_erro(text, text[], text) to authenticated, anon;
grant execute on function public.tordem_exige_negado(text, text) to authenticated, anon;
grant execute on function public.tordem_exige_linhas(text, bigint, text) to authenticated, anon;
grant execute on function public.tordem_exige_conta(text, bigint, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
  ('91000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'admin-ordem@example.com'),
  ('91000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'equipe-editar-ordem@example.com'),
  ('91000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'equipe-ver-ordem@example.com'),
  ('91000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', 'equipe-sem-ordem@example.com'),
  ('91000000-0000-0000-0000-0000000000d5', 'authenticated', 'authenticated', 'cliente-ordem@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('91000000-0000-0000-0000-0000000000d1', 'admin', 'Admin Ordem', true, false),
  ('91000000-0000-0000-0000-0000000000d2', 'equipe', 'Equipe Editar Ordem', true, false),
  ('91000000-0000-0000-0000-0000000000d3', 'equipe', 'Equipe Ver Ordem', true, false),
  ('91000000-0000-0000-0000-0000000000d4', 'equipe', 'Equipe Sem Ordem', true, false),
  ('91000000-0000-0000-0000-0000000000d5', 'cliente', 'Cliente Ordem', true, false);

insert into public.equipe_permissoes (profile_id, permissao)
values
  ('91000000-0000-0000-0000-0000000000d2', 'empreendimentos.ver'),
  ('91000000-0000-0000-0000-0000000000d2', 'empreendimentos.editar'),
  ('91000000-0000-0000-0000-0000000000d3', 'empreendimentos.ver');

insert into public.empreendimentos (id, nome, cidade)
values
  ('91000000-0000-0000-0000-00000000e001', 'Empreendimento 1 Ordem Teste', 'Cidade 1'),
  ('91000000-0000-0000-0000-00000000e002', 'Empreendimento 2 Ordem Teste', 'Cidade 2'),
  ('91000000-0000-0000-0000-00000000e003', 'Empreendimento 3 Ordem Teste', 'Cidade 3');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-0000000000d5');

insert into public.modelos_etapas (id, nome)
values ('91000000-0000-0000-0000-0000000000f1', 'Modelo Ordem Projetos Teste');

-- Empreendimento 1: Casa antes de Alfa na inserção; pais antes dos filhos (a trigger de hierarquia exige).
insert into public.projetos (id, empreendimento_id, nome, projeto_pai_id)
values
  ('91000000-0000-0000-0000-00000000a003', '91000000-0000-0000-0000-00000000e001', 'Casa', null),
  ('91000000-0000-0000-0000-00000000a002', '91000000-0000-0000-0000-00000000e001', 'Beta', null),
  ('91000000-0000-0000-0000-00000000a001', '91000000-0000-0000-0000-00000000e001', 'Alfa', null),
  ('91000000-0000-0000-0000-00000000a005', '91000000-0000-0000-0000-00000000e001', 'Zeta', '91000000-0000-0000-0000-00000000a002'),
  ('91000000-0000-0000-0000-00000000a004', '91000000-0000-0000-0000-00000000e001', 'Dado', '91000000-0000-0000-0000-00000000a002');

-- Empreendimento 2: P3, P1, P4, P2 na raiz; F2 e F1 sob P1.
insert into public.projetos (id, empreendimento_id, nome, projeto_pai_id)
values
  ('91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000e002', 'P3', null),
  ('91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000e002', 'P1', null),
  ('91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000e002', 'P4', null),
  ('91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000e002', 'P2', null),
  ('91000000-0000-0000-0000-00000000b202', '91000000-0000-0000-0000-00000000e002', 'F2', '91000000-0000-0000-0000-00000000b101'),
  ('91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000e002', 'F1', '91000000-0000-0000-0000-00000000b101');

-- ---------------------------------------------------------------------------
-- Estrutura (como postgres)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projetos' and column_name = 'ordem'
      and data_type = 'integer' and is_nullable = 'NO' and column_default = '0'
  ) then
    raise exception 'FALHA: falta a coluna projetos.ordem (integer, not null, padrão 0)';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.projetos'::regclass and conname = 'projetos_ordem_check' and contype = 'c') then
    raise exception 'FALHA: falta o check projetos_ordem_check';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'projetos' and indexname = 'projetos_ordem_idx'
      and indexdef like '%(empreendimento_id, projeto_pai_id, ordem)%'
  ) then
    raise exception 'FALHA: falta o índice projetos_ordem_idx (empreendimento_id, projeto_pai_id, ordem)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.projetos'::regclass and tgname = 'projetos_ordem_ao_mudar_pai' and tgenabled = 'O' and not tgisinternal) then
    raise exception 'FALHA: falta a trigger projetos_ordem_ao_mudar_pai (ligada)';
  end if;
  -- O preenchimento da migration desliga estes dois triggers; eles precisam ter voltado.
  if (select count(*) from pg_trigger where tgrelid = 'public.projetos'::regclass and tgname in ('projetos_registrar_auditoria', 'projetos_definir_atualizado_em') and tgenabled = 'O') <> 2 then
    raise exception 'FALHA: os triggers de auditoria e de atualizado_em de projetos precisam estar ligados';
  end if;
  if has_function_privilege('anon', 'public.projetos_ordem_ao_mudar_pai()', 'execute')
    or has_function_privilege('authenticated', 'public.projetos_ordem_ao_mudar_pai()', 'execute') then
    raise exception 'FALHA: a função da trigger de ordem não pode ser executável diretamente';
  end if;
  if has_function_privilege('anon', 'public.reordenar_projetos(uuid, uuid, uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.reordenar_projetos(uuid, uuid, uuid[])', 'execute') then
    raise exception 'FALHA: reordenar_projetos deve ser executável só por authenticated';
  end if;
  if has_function_privilege('anon', 'public.criar_projeto_de_modelo(uuid, uuid, text, uuid)', 'execute')
    or not has_function_privilege('authenticated', 'public.criar_projeto_de_modelo(uuid, uuid, text, uuid)', 'execute') then
    raise exception 'FALHA: criar_projeto_de_modelo deve continuar executável só por authenticated';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('reordenar_projetos', 'criar_projeto_de_modelo', 'projetos_ordem_ao_mudar_pai')
      and (p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))
  ) then
    raise exception 'FALHA: as funções da ordem devem ser security invoker com search_path vazio';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Preenchimento: alfabético por irmãos (mesma instrução da migration, restrita à fixture)
-- ---------------------------------------------------------------------------

select public.tordem_exige_conta($q$select count(*) from public.projetos where empreendimento_id in ('91000000-0000-0000-0000-00000000e001', '91000000-0000-0000-0000-00000000e002') and ordem <> 0$q$, 0, 'projeto inserido sem ordem fica com 0');

update public.projetos p
set ordem = s.posicao
from (
  select q.id, (row_number() over (partition by q.empreendimento_id, q.projeto_pai_id order by q.nome, q.id) - 1)::integer as posicao
  from public.projetos q
  where q.empreendimento_id in ('91000000-0000-0000-0000-00000000e001', '91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000e003')
) s
where s.id = p.id;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e001', null,
  array['91000000-0000-0000-0000-00000000a001', '91000000-0000-0000-0000-00000000a002', '91000000-0000-0000-0000-00000000a003']::uuid[], 'raízes do empreendimento 1 em ordem alfabética');
select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e001', '91000000-0000-0000-0000-00000000a002',
  array['91000000-0000-0000-0000-00000000a004', '91000000-0000-0000-0000-00000000a005']::uuid[], 'dependentes de Beta em ordem alfabética (Dado, Zeta)');
select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', null,
  array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[], 'raízes do empreendimento 2 em ordem alfabética');
select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b101',
  array['91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000b202']::uuid[], 'dependentes de P1 em ordem alfabética (F1, F2)');

-- ---------------------------------------------------------------------------
-- criar_projeto_de_modelo: projeto novo vai para o fim dos irmãos
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select public.tordem_exige_ok($q$select public.criar_projeto_de_modelo('91000000-0000-0000-0000-00000000e001', '91000000-0000-0000-0000-0000000000f1', 'Novo A', null)$q$, 'criar raiz nova');
select public.tordem_exige_ok($q$select public.criar_projeto_de_modelo('91000000-0000-0000-0000-00000000e001', '91000000-0000-0000-0000-0000000000f1', 'Novo B', '91000000-0000-0000-0000-00000000a002')$q$, 'criar dependente novo');
select public.tordem_exige_ok($q$select public.criar_projeto_de_modelo('91000000-0000-0000-0000-00000000e003', '91000000-0000-0000-0000-0000000000f1', 'Novo C', null)$q$, 'criar o primeiro projeto de um empreendimento vazio');

select public.tordem_exige_conta($q$select count(*) from public.projetos where nome = 'Novo A' and empreendimento_id = '91000000-0000-0000-0000-00000000e001' and projeto_pai_id is null and ordem = 3$q$, 1, 'raiz nova entra depois de Casa (ordem 3)');
select public.tordem_exige_conta($q$select count(*) from public.projetos where nome = 'Novo B' and projeto_pai_id = '91000000-0000-0000-0000-00000000a002' and ordem = 2$q$, 1, 'dependente novo entra depois de Zeta (ordem 2)');
select public.tordem_exige_conta($q$select count(*) from public.projetos where nome = 'Novo C' and empreendimento_id = '91000000-0000-0000-0000-00000000e003' and ordem = 0$q$, 1, 'primeiro projeto do empreendimento vazio tem ordem 0');
select public.tordem_exige_erro($q$select public.criar_projeto_de_modelo('91000000-0000-0000-0000-00000000e001', '91000000-0000-0000-0000-0000000000f1', 'Novo D', '91000000-0000-0000-0000-00000000b101')$q$, array['23514'], 'pai de outro empreendimento continua recusado');
select public.tordem_exige_conta($q$select count(*) from public.projetos where nome = 'Novo D'$q$, 0, 'criação recusada não deixa projeto');

reset role;

-- ---------------------------------------------------------------------------
-- Trocar o pai manda o projeto para o fim dos novos irmãos
-- ---------------------------------------------------------------------------

-- Raízes: Alfa 0, Beta 1, Casa 2, Novo A 3. Casa passa a depender de Alfa, que não tem dependentes: ordem 0.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select public.tordem_exige_linhas($q$update public.projetos set projeto_pai_id = '91000000-0000-0000-0000-00000000a001' where id = '91000000-0000-0000-0000-00000000a003'$q$, 1, 'equipe troca o pai de Casa para Alfa');
select public.tordem_exige_conta($q$select count(*) from public.projetos where id = '91000000-0000-0000-0000-00000000a003' and ordem = 0$q$, 1, 'Casa é o primeiro dependente de Alfa');
select public.tordem_exige_linhas($q$update public.projetos set projeto_pai_id = '91000000-0000-0000-0000-00000000a001' where id = '91000000-0000-0000-0000-00000000a004'$q$, 1, 'equipe troca o pai de Dado para Alfa');
select public.tordem_exige_conta($q$select count(*) from public.projetos where id = '91000000-0000-0000-0000-00000000a004' and ordem = 1$q$, 1, 'Dado entra depois de Casa');
select public.tordem_exige_linhas($q$update public.projetos set projeto_pai_id = null where id = '91000000-0000-0000-0000-00000000a004'$q$, 1, 'equipe tira o pai de Dado');
select public.tordem_exige_conta($q$select count(*) from public.projetos where id = '91000000-0000-0000-0000-00000000a004' and projeto_pai_id is null and ordem = 4$q$, 1, 'Dado entra no fim das raízes (depois de Novo A, ordem 3)');

-- Sem troca de pai, a ordem fica: renomear, regravar o mesmo pai.
select public.tordem_exige_linhas($q$update public.projetos set nome = 'Zeta renomeado' where id = '91000000-0000-0000-0000-00000000a005'$q$, 1, 'renomear');
select public.tordem_exige_linhas($q$update public.projetos set projeto_pai_id = projeto_pai_id where id = '91000000-0000-0000-0000-00000000a005'$q$, 1, 'regravar o mesmo pai');
select public.tordem_exige_linhas($q$update public.projetos set projeto_pai_id = '91000000-0000-0000-0000-00000000a002' where id = '91000000-0000-0000-0000-00000000a005'$q$, 1, 'regravar o mesmo pai por valor');
select public.tordem_exige_conta($q$select count(*) from public.projetos where id = '91000000-0000-0000-0000-00000000a005' and ordem = 1$q$, 1, 'Zeta mantém a ordem 1');

-- A validação de hierarquia continua valendo: Alfa depender de Casa (que depende de Alfa) fecha um ciclo.
select public.tordem_exige_erro($q$update public.projetos set projeto_pai_id = '91000000-0000-0000-0000-00000000a003' where id = '91000000-0000-0000-0000-00000000a001'$q$, array['23514'], 'ciclo continua recusado');
select public.tordem_exige_conta($q$select count(*) from public.projetos where id = '91000000-0000-0000-0000-00000000a001' and projeto_pai_id is null and ordem = 0$q$, 1, 'ciclo recusado não muda a ordem');

reset role;

-- Excluir o pai: os dependentes viram raízes no fim das raízes, com ordens diferentes entre si.
-- Raízes antes: Alfa 0, Beta 1, Novo A 3, Dado 4. Dependentes de Beta: Zeta renomeado (1) e Novo B (2).
delete from public.projetos where id = '91000000-0000-0000-0000-00000000a002';

select public.tordem_exige_conta($q$select count(*) from public.projetos where id in ('91000000-0000-0000-0000-00000000a005') and projeto_pai_id is null$q$, 1, 'dependente do pai excluído virou raiz');
select public.tordem_exige_conta($q$select count(distinct ordem) from public.projetos where nome in ('Zeta renomeado', 'Novo B') and empreendimento_id = '91000000-0000-0000-0000-00000000e001' and projeto_pai_id is null and ordem >= 5$q$, 2, 'dependentes do pai excluído vão para o fim das raízes, cada um com a sua ordem');

-- ---------------------------------------------------------------------------
-- reordenar_projetos: equipe com empreendimentos.editar
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select public.tordem_exige_ok($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, 'lista completa invertida');

reset role;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', null,
  array['91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[], 'raízes na nova ordem, posições 0 a 3');
select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b101',
  array['91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000b202']::uuid[], 'reordenar as raízes não mexe nos dependentes');

-- Só o que mudou de lugar gera auditoria: trocar os dois primeiros altera 2 linhas; repetir a mesma ordem, nenhuma.
create temp table tordem_auditoria_antes on commit drop as
select count(*) as total from public.auditoria
where tabela = 'projetos' and acao = 'UPDATE'
  and registro_id in ('91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104');

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select public.tordem_exige_ok($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, 'trocar os dois primeiros');
reset role;

do $$
declare
  v_antes bigint := (select total from tordem_auditoria_antes);
  v_depois bigint;
begin
  select count(*) into v_depois from public.auditoria
  where tabela = 'projetos' and acao = 'UPDATE'
    and registro_id in ('91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104');
  if v_depois - v_antes <> 2 then
    raise exception 'FALHA: trocar dois projetos deveria gerar 2 registros de auditoria, gerou %', v_depois - v_antes;
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select public.tordem_exige_ok($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, 'repetir a mesma ordem');
reset role;

do $$
declare
  v_antes bigint := (select total from tordem_auditoria_antes) + 2;
  v_depois bigint;
begin
  select count(*) into v_depois from public.auditoria
  where tabela = 'projetos' and acao = 'UPDATE'
    and registro_id in ('91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104');
  if v_depois <> v_antes then
    raise exception 'FALHA: repetir a mesma ordem não deveria gravar nada (auditoria foi de % para %)', v_antes, v_depois;
  end if;
end $$;

-- Dependentes de P1: lista completa do nível.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select public.tordem_exige_ok($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b101', array['91000000-0000-0000-0000-00000000b202', '91000000-0000-0000-0000-00000000b201']::uuid[])$q$, 'lista completa dos dependentes de P1');
reset role;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b101',
  array['91000000-0000-0000-0000-00000000b202', '91000000-0000-0000-0000-00000000b201']::uuid[], 'dependentes de P1 na nova ordem');

-- Listas que não são exatamente os irmãos do nível: tudo recusado com 22023, sem mudar nada.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102']::uuid[])$q$, array['22023'], 'lista incompleta (falta P1)');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000a001']::uuid[])$q$, array['22023'], 'lista com projeto de outro empreendimento a mais');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000a001']::uuid[])$q$, array['22023'], 'lista com estranho no lugar de P1');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-0000000000ee']::uuid[])$q$, array['22023'], 'lista com id inexistente');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, array['22023'], 'lista com repetido e todos os irmãos');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102']::uuid[])$q$, array['22023'], 'lista com repetido no tamanho certo');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', null, '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, array['22023'], 'lista com valor nulo');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array[]::uuid[])$q$, array['22023'], 'lista vazia');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, null)$q$, array['22023'], 'lista nula');
select public.tordem_exige_erro($q$select public.reordenar_projetos(null, null, array['91000000-0000-0000-0000-00000000b103']::uuid[])$q$, array['22023'], 'empreendimento nulo');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e001', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, array['22023'], 'irmãos certos com o empreendimento errado');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000b202']::uuid[])$q$, array['22023'], 'dependentes de P1 pedidos como raízes');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b101', array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[])$q$, array['22023'], 'raízes pedidas como dependentes de P1');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000b202']::uuid[])$q$, array['22023'], 'raízes e dependentes misturados');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b102', array['91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000b202']::uuid[])$q$, array['22023'], 'dependentes de P1 pedidos sob P2');
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000a001', array['91000000-0000-0000-0000-00000000b201', '91000000-0000-0000-0000-00000000b202']::uuid[])$q$, array['22023'], 'pai de outro empreendimento');

reset role;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', null,
  array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[], 'recusas não mudaram as raízes');
select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', '91000000-0000-0000-0000-00000000b101',
  array['91000000-0000-0000-0000-00000000b202', '91000000-0000-0000-0000-00000000b201']::uuid[], 'recusas não mudaram os dependentes');
-- ---------------------------------------------------------------------------
-- Quem não pode reordenar
-- ---------------------------------------------------------------------------

-- Lista completa e válida das raízes do empreendimento 2 (P1 a P4): só a permissão decide.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[])$q$, array['42501'], 'equipe só com empreendimentos.ver não reordena');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d4","role":"authenticated"}';
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[])$q$, array['42501'], 'equipe sem permissão não reordena');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d5","role":"authenticated"}';
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[])$q$, array['42501'], 'cliente não reordena');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select public.tordem_exige_erro($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[])$q$, array['42501'], 'anon não reordena');
reset role;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', null,
  array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[], 'tentativas negadas não mudaram a ordem');

-- O RLS de projetos continua o mesmo: também não dá para gravar a coluna direto.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
select public.tordem_exige_negado($q$update public.projetos set ordem = 9 where id = '91000000-0000-0000-0000-00000000b101'$q$, 'equipe só com .ver não grava a ordem');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d4","role":"authenticated"}';
select public.tordem_exige_negado($q$update public.projetos set ordem = 9 where id = '91000000-0000-0000-0000-00000000b101'$q$, 'equipe sem permissão não grava a ordem');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d5","role":"authenticated"}';
select public.tordem_exige_negado($q$update public.projetos set ordem = 9 where id = '91000000-0000-0000-0000-00000000b101'$q$, 'cliente não grava a ordem');
select public.tordem_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '91000000-0000-0000-0000-00000000e002' and ordem >= 0$q$, 6, 'cliente lê a ordem dos projetos do próprio empreendimento');
select public.tordem_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '91000000-0000-0000-0000-00000000e001'$q$, 0, 'cliente não vê projetos de outro empreendimento');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select public.tordem_exige_negado($q$update public.projetos set ordem = 9 where id = '91000000-0000-0000-0000-00000000b101'$q$, 'anon não grava a ordem');
reset role;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', null,
  array['91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b101']::uuid[], 'tentativas de gravar direto não mudaram a ordem');

-- A ordem nunca é negativa.
select public.tordem_exige_erro($q$update public.projetos set ordem = -1 where id = '91000000-0000-0000-0000-00000000b101'$q$, array['23514'], 'ordem negativa recusada');

-- ---------------------------------------------------------------------------
-- Admin reordena
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select public.tordem_exige_ok($q$select public.reordenar_projetos('91000000-0000-0000-0000-00000000e002', null, array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[])$q$, 'admin reordena as raízes');
reset role;

select public.tordem_exige_grupo('91000000-0000-0000-0000-00000000e002', null,
  array['91000000-0000-0000-0000-00000000b101', '91000000-0000-0000-0000-00000000b102', '91000000-0000-0000-0000-00000000b103', '91000000-0000-0000-0000-00000000b104']::uuid[], 'admin deixou as raízes em P1, P2, P3, P4');

select 'OK: todas as verificações da ordem dos projetos passaram' as resultado;

rollback;
