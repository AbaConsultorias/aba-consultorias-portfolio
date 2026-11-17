-- Testes da Etapa 4 (hierarquia de projetos): coluna projetos.projeto_pai_id e a trigger
-- validar_hierarquia_projetos.
-- Como rodar (somente em banco de TESTE, nunca em produção):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa4_hierarquia_rls.sql
-- Rode com o usuário postgres, depois de TODAS as migrations, inclusive
-- 20261030140000_etapa4_hierarquia_projetos.sql. Tudo acontece dentro de uma transação que
-- termina em ROLLBACK. Se alguma verificação falhar, o script para com "FALHA: ..."; se chegar
-- ao fim, o último SELECT imprime "OK". Há dados reais no banco: o teste só conta e mexe nas
-- fixtures próprias (ids 41000000-...).
-- Dois ciclos concorrentes (A->B e B->A em transações paralelas) terminam em deadlock de um
-- deles por causa do FOR UPDATE na subida da cadeia; isso não cabe num teste de sessão única.

begin;

create function public.t4h_exige_negado(p_sql text, p_msg text)
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

create function public.t4h_exige_erro(p_sql text, p_estados text[], p_msg text)
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

create function public.t4h_exige_linhas(p_sql text, p_esperado bigint, p_msg text)
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

create function public.t4h_exige_conta(p_sql text, p_esperado bigint, p_msg text)
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

grant execute on function public.t4h_exige_negado(text, text) to authenticated;
grant execute on function public.t4h_exige_erro(text, text[], text) to authenticated;
grant execute on function public.t4h_exige_linhas(text, bigint, text) to authenticated;
grant execute on function public.t4h_exige_conta(text, bigint, text) to authenticated;

-- Fixture: cliente A (empreendimento A), cliente B (empreendimento B) e equipe.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000041c1', 'authenticated', 'authenticated', 'cliente-a-etapa4h@example.com'),
  ('00000000-0000-0000-0000-0000000041c2', 'authenticated', 'authenticated', 'cliente-b-etapa4h@example.com'),
  ('00000000-0000-0000-0000-0000000041b1', 'authenticated', 'authenticated', 'equipe-etapa4h@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000041c1', 'cliente', 'Cliente A Hierarquia', true, false),
  ('00000000-0000-0000-0000-0000000041c2', 'cliente', 'Cliente B Hierarquia', true, false),
  ('00000000-0000-0000-0000-0000000041b1', 'equipe', 'Equipe Hierarquia', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000041b1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome, cidade)
values
  ('41000000-0000-0000-0000-00000000a001', 'Empreendimento A Hierarquia Teste', 'Cidade A'),
  ('41000000-0000-0000-0000-00000000a002', 'Empreendimento B Hierarquia Teste', 'Cidade B');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('41000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000041c1'),
  ('41000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000041c2');

-- A1..A4 e A9 no empreendimento A; B1 no empreendimento B.
insert into public.projetos (id, empreendimento_id, nome)
values
  ('41000000-0000-0000-0000-000000005a01', '41000000-0000-0000-0000-00000000a001', 'Projeto A1 Hierarquia'),
  ('41000000-0000-0000-0000-000000005a02', '41000000-0000-0000-0000-00000000a001', 'Projeto A2 Hierarquia'),
  ('41000000-0000-0000-0000-000000005a03', '41000000-0000-0000-0000-00000000a001', 'Projeto A3 Hierarquia'),
  ('41000000-0000-0000-0000-000000005a04', '41000000-0000-0000-0000-00000000a001', 'Projeto A4 Hierarquia'),
  ('41000000-0000-0000-0000-000000005a09', '41000000-0000-0000-0000-00000000a001', 'Projeto A9 Hierarquia'),
  ('41000000-0000-0000-0000-000000005b01', '41000000-0000-0000-0000-00000000a002', 'Projeto B1 Hierarquia');

-- Estrutura (como postgres): coluna, índice, trigger e função fechada para chamada direta.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projetos' and column_name = 'projeto_pai_id'
      and data_type = 'uuid' and is_nullable = 'YES'
  ) then
    raise exception 'FALHA: falta a coluna projetos.projeto_pai_id (uuid, nullable)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'projetos' and indexname = 'projetos_projeto_pai_idx') then
    raise exception 'FALHA: falta o índice projetos_projeto_pai_idx';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.projetos'::regclass and tgname = 'projetos_validar_hierarquia' and not tgisinternal) then
    raise exception 'FALHA: falta a trigger projetos_validar_hierarquia';
  end if;
  if has_function_privilege('anon', 'public.validar_hierarquia_projetos()', 'execute')
    or has_function_privilege('authenticated', 'public.validar_hierarquia_projetos()', 'execute') then
    raise exception 'FALHA: a função da trigger de hierarquia não pode ser executável diretamente';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'validar_hierarquia_projetos'
      and (p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))
  ) then
    raise exception 'FALHA: validar_hierarquia_projetos deve ser security invoker com search_path vazio';
  end if;
end $$;

-- Pai válido (mesmo empreendimento): A2 -> A1 e A3 -> A2.
select public.t4h_exige_linhas($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a01' where id = '41000000-0000-0000-0000-000000005a02'$q$, 1, 'pai válido do mesmo empreendimento');
select public.t4h_exige_linhas($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a02' where id = '41000000-0000-0000-0000-000000005a03'$q$, 1, 'segundo nível de dependência');
select public.t4h_exige_linhas($q$insert into public.projetos (id, empreendimento_id, nome, projeto_pai_id) values ('41000000-0000-0000-0000-000000005a05', '41000000-0000-0000-0000-00000000a001', 'Projeto A5 Hierarquia', '41000000-0000-0000-0000-000000005a01')$q$, 1, 'criar já com pai válido');

-- Pai de outro empreendimento, inexistente e auto-referência.
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005b01' where id = '41000000-0000-0000-0000-000000005a04'$q$, array['23514'], 'pai de outro empreendimento');
select public.t4h_exige_erro($q$insert into public.projetos (id, empreendimento_id, nome, projeto_pai_id) values ('41000000-0000-0000-0000-000000005a06', '41000000-0000-0000-0000-00000000a001', 'Projeto A6 Hierarquia', '41000000-0000-0000-0000-000000005b01')$q$, array['23514'], 'criar com pai de outro empreendimento');
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a04' where id = '41000000-0000-0000-0000-000000005a04'$q$, array['23514'], 'projeto dependendo de si mesmo');
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-0000000050ff' where id = '41000000-0000-0000-0000-000000005a04'$q$, array['23514', '23503'], 'pai inexistente');

-- Ciclos: A1 <- A2 <- A3 (A3 depende de A2, que depende de A1).
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a02' where id = '41000000-0000-0000-0000-000000005a01'$q$, array['23514'], 'ciclo A1 -> A2 -> A1');
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a03' where id = '41000000-0000-0000-0000-000000005a01'$q$, array['23514'], 'ciclo A1 -> A3 -> A2 -> A1');
select public.t4h_exige_conta($q$select count(*) from public.projetos where id = '41000000-0000-0000-0000-000000005a01' and projeto_pai_id is null$q$, 1, 'ciclo recusado não grava o pai');

-- Ramos independentes na mesma árvore continuam válidos (sem falso positivo de ciclo).
select public.t4h_exige_linhas($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a03' where id = '41000000-0000-0000-0000-000000005a04'$q$, 1, 'terceiro nível');
select public.t4h_exige_linhas($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a01' where id = '41000000-0000-0000-0000-000000005a09'$q$, 1, 'segundo filho do mesmo pai');
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a04' where id = '41000000-0000-0000-0000-000000005a01'$q$, array['23514'], 'ciclo longo A1 -> A4 -> A3 -> A2 -> A1');

-- Projeto não muda de empreendimento (regra anterior, que protege a hierarquia).
select public.t4h_exige_erro($q$update public.projetos set empreendimento_id = '41000000-0000-0000-0000-00000000a002' where id = '41000000-0000-0000-0000-000000005a02'$q$, array['23514'], 'projeto não troca de empreendimento');

-- Cadeia longa: B1 mais 20 projetos encadeados (21 níveis) passam; o próximo é recusado.
do $$
declare
  v_anterior uuid := '41000000-0000-0000-0000-000000005b01';
  v_novo uuid;
  v_n int;
  v_estado text;
begin
  for v_n in 1..20 loop
    v_novo := gen_random_uuid();
    insert into public.projetos (id, empreendimento_id, nome, projeto_pai_id)
    values (v_novo, '41000000-0000-0000-0000-00000000a002', 'Cadeia Hierarquia ' || v_n, v_anterior);
    v_anterior := v_novo;
  end loop;

  begin
    insert into public.projetos (id, empreendimento_id, nome, projeto_pai_id)
    values (gen_random_uuid(), '41000000-0000-0000-0000-00000000a002', 'Cadeia Hierarquia 21', v_anterior);
  exception when others then
    v_estado := sqlstate;
  end;
  if v_estado is distinct from '23514' then
    raise exception 'FALHA: cadeia acima do limite deveria ser recusada com 23514 (veio %)', v_estado;
  end if;
end $$;

-- Excluir o pai deixa o filho com null; os netos continuam ligados ao filho.
select public.t4h_exige_linhas($q$delete from public.projetos where id = '41000000-0000-0000-0000-000000005a01'$q$, 1, 'excluir o pai');
select public.t4h_exige_conta($q$select count(*) from public.projetos where id in ('41000000-0000-0000-0000-000000005a02', '41000000-0000-0000-0000-000000005a05', '41000000-0000-0000-0000-000000005a09') and projeto_pai_id is null$q$, 3, 'filhos do pai excluído ficam com null');
select public.t4h_exige_conta($q$select count(*) from public.projetos where id = '41000000-0000-0000-0000-000000005a03' and projeto_pai_id = '41000000-0000-0000-0000-000000005a02'$q$, 1, 'neto continua ligado ao filho');

-- Equipe grava a coluna pela sessão (RLS) e consegue limpar o pai.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000041b1","role":"authenticated"}';

select public.t4h_exige_linhas($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a02' where id = '41000000-0000-0000-0000-000000005a09'$q$, 1, 'equipe define o pai');
select public.t4h_exige_erro($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a09' where id = '41000000-0000-0000-0000-000000005a02'$q$, array['23514'], 'equipe também não cria ciclo');
select public.t4h_exige_linhas($q$update public.projetos set projeto_pai_id = null where id = '41000000-0000-0000-0000-000000005a09'$q$, 1, 'equipe limpa o pai');

-- Criar pelo modelo já com o pai é atômico: pai inválido não deixa projeto órfão.
do $$
declare
  v_modelo uuid;
  v_projeto uuid;
begin
  insert into public.modelos_etapas (nome) values ('Modelo Hierarquia T4H') returning id into v_modelo;
  v_projeto := public.criar_projeto_de_modelo('41000000-0000-0000-0000-00000000a001', v_modelo, 'Projeto RPC Hierarquia', '41000000-0000-0000-0000-000000005a02');
  if not exists (select 1 from public.projetos where id = v_projeto and projeto_pai_id = '41000000-0000-0000-0000-000000005a02') then
    raise exception 'FALHA: criar_projeto_de_modelo não gravou o pai';
  end if;
  begin
    perform public.criar_projeto_de_modelo('41000000-0000-0000-0000-00000000a001', v_modelo, 'Projeto RPC Outro Hierarquia', '41000000-0000-0000-0000-000000005b01');
    raise exception 'FALHA: criar_projeto_de_modelo aceitou pai de outro empreendimento';
  exception when sqlstate '23514' then
    null;
  end;
  if exists (select 1 from public.projetos where nome = 'Projeto RPC Outro Hierarquia') then
    raise exception 'FALHA: criar_projeto_de_modelo deixou projeto órfão';
  end if;
end $$;

reset role;

-- Cliente A lê os projetos do seu empreendimento (com a coluna), mas não altera nada.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000041c1","role":"authenticated"}';

select public.t4h_exige_conta($q$select count(*) from public.projetos where id in ('41000000-0000-0000-0000-000000005a02', '41000000-0000-0000-0000-000000005a03') and projeto_pai_id is not null$q$, 1, 'cliente A lê o pai do seu projeto');
select public.t4h_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '41000000-0000-0000-0000-00000000a002'$q$, 0, 'cliente A não vê projetos do empreendimento B');
select public.t4h_exige_negado($q$update public.projetos set projeto_pai_id = null where id = '41000000-0000-0000-0000-000000005a03'$q$, 'cliente não pode limpar o pai');
select public.t4h_exige_negado($q$update public.projetos set projeto_pai_id = '41000000-0000-0000-0000-000000005a02' where id = '41000000-0000-0000-0000-000000005a04'$q$, 'cliente não pode definir o pai');
-- A trigger roda antes do WITH CHECK da RLS e o FOR UPDATE não enxerga o pai para quem não tem
-- política de UPDATE: o INSERT do cliente cai em 23514 ou 42501; o que importa é que seja recusado.
select public.t4h_exige_erro($q$insert into public.projetos (empreendimento_id, nome, projeto_pai_id) values ('41000000-0000-0000-0000-00000000a001', 'Projeto do cliente Hierarquia', '41000000-0000-0000-0000-000000005a02')$q$, array['42501', '23514'], 'cliente não cria projeto');
select public.t4h_exige_erro($q$insert into public.projetos (empreendimento_id, nome) values ('41000000-0000-0000-0000-00000000a001', 'Projeto do cliente sem pai Hierarquia')$q$, array['42501'], 'cliente não cria projeto sem pai');

reset role;

-- Cliente B não enxerga nem altera nada do empreendimento A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000041c2","role":"authenticated"}';

select public.t4h_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '41000000-0000-0000-0000-00000000a001'$q$, 0, 'cliente B não vê projetos do empreendimento A');
select public.t4h_exige_negado($q$update public.projetos set projeto_pai_id = null where empreendimento_id = '41000000-0000-0000-0000-00000000a001'$q$, 'cliente B não altera projetos do empreendimento A');

reset role;

-- A coluna não mudou nada por baixo dos panos nas tentativas negadas.
select public.t4h_exige_conta($q$select count(*) from public.projetos where id = '41000000-0000-0000-0000-000000005a03' and projeto_pai_id = '41000000-0000-0000-0000-000000005a02'$q$, 1, 'tentativas do cliente não alteraram o pai');
select public.t4h_exige_conta($q$select count(*) from public.projetos where id = '41000000-0000-0000-0000-000000005a04' and projeto_pai_id = '41000000-0000-0000-0000-000000005a03'$q$, 1, 'tentativas do cliente não alteraram o neto');

select 'OK: todas as verificações da Etapa 4 (hierarquia de projetos) passaram' as resultado;

rollback;
