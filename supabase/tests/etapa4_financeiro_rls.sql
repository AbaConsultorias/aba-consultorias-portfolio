-- Testes de RLS da Etapa 4, frente C (financeiro do portal).
-- Como rodar: depois de aplicar TODAS as migrations (inclusive a da Etapa 4), em banco de teste:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa4_financeiro_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script
-- para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
--
-- Cobre itens_financeiros, parcelas, parcelas_situacao e nome_fornecedor() como o
-- portal usa: cliente A/B só leem o próprio empreendimento, fornecedor só o item
-- dele, conta inativa/pendente e empreiteiro nada, anon nada; só a equipe escreve.
--
-- Fixture (ids com prefixo 40000000-...):
--   empreendimento A (e01) e B (e02); cliente A (c1), cliente B (c2), cliente A
--   com troca de senha pendente (c3), cliente A inativo (c4); empreiteiro (b1);
--   fornecedor A (f01, usuário f1), fornecedor B (f02, usuário f2); equipe (e1); admin (a1).
--   Itens: a001 (A, fornecedor A), a002 (A, sem fornecedor), a003 (B, fornecedor B),
--   a005 (A, valor máximo de bigint).

begin;

insert into auth.users (id, aud, role, email)
values
  ('40000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e4c-cliente-a@example.com'),
  ('40000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'e4c-cliente-b@example.com'),
  ('40000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'e4c-cliente-pendente@example.com'),
  ('40000000-0000-0000-0000-0000000000c4', 'authenticated', 'authenticated', 'e4c-cliente-inativo@example.com'),
  ('40000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e4c-empreiteiro@example.com'),
  ('40000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e4c-fornecedor-a@example.com'),
  ('40000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'e4c-fornecedor-b@example.com'),
  ('40000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e4c-equipe@example.com'),
  ('40000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e4c-admin@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('40000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente A Teste', true, false),
  ('40000000-0000-0000-0000-0000000000c2', 'cliente', 'Cliente B Teste', true, false),
  ('40000000-0000-0000-0000-0000000000c3', 'cliente', 'Cliente Pendente Teste', true, true),
  ('40000000-0000-0000-0000-0000000000c4', 'cliente', 'Cliente Inativo Teste', false, false),
  ('40000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste', true, false),
  ('40000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor A Teste', true, false),
  ('40000000-0000-0000-0000-0000000000f2', 'fornecedor', 'Fornecedor B Teste', true, false),
  ('40000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste', true, false),
  ('40000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['40000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome)
values
  ('40000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste'),
  ('40000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('40000000-0000-0000-0000-000000000e01', '40000000-0000-0000-0000-0000000000c1'),
  ('40000000-0000-0000-0000-000000000e02', '40000000-0000-0000-0000-0000000000c2'),
  ('40000000-0000-0000-0000-000000000e01', '40000000-0000-0000-0000-0000000000c3'),
  ('40000000-0000-0000-0000-000000000e01', '40000000-0000-0000-0000-0000000000c4');

insert into public.obras (id, empreendimento_id, nome)
values ('40000000-0000-0000-0000-000000000b01', '40000000-0000-0000-0000-000000000e01', 'Obra A Teste');

insert into public.obra_empreiteiros (obra_id, profile_id)
values ('40000000-0000-0000-0000-000000000b01', '40000000-0000-0000-0000-0000000000b1');

insert into public.fornecedores (id, razao_social, nome_fantasia)
values
  ('40000000-0000-0000-0000-000000000f01', 'Fornecedor A Razão Teste', 'Fornecedor A Fantasia Teste'),
  ('40000000-0000-0000-0000-000000000f02', 'Fornecedor B Razão Teste', null);

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values
  ('40000000-0000-0000-0000-000000000f01', '40000000-0000-0000-0000-0000000000f1'),
  ('40000000-0000-0000-0000-000000000f02', '40000000-0000-0000-0000-0000000000f2');

insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos, observacao)
values
  ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-000000000e01', '40000000-0000-0000-0000-000000000f01', 'Item A fornecedor A', 100000, 'Observação visível'),
  ('40000000-0000-0000-0000-00000000a002', '40000000-0000-0000-0000-000000000e01', null, 'Item A sem fornecedor', 20000, null),
  ('40000000-0000-0000-0000-00000000a003', '40000000-0000-0000-0000-000000000e02', '40000000-0000-0000-0000-000000000f02', 'Item B fornecedor B', 30000, null),
  ('40000000-0000-0000-0000-00000000a005', '40000000-0000-0000-0000-000000000e01', null, 'Item A valor máximo', 9223372036854775807, null);

-- b001 aberta e vencida; b002 quitada por data; b005 previsto zero; b006 pago em excesso (item a001);
-- b003 pagamento parcial sem data (a002); b004 (a003, empreendimento B); b007 valor máximo (a005).
insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos, data_pagamento, valor_pago_centavos)
values
  ('40000000-0000-0000-0000-00000000b001', '40000000-0000-0000-0000-00000000a001', '2020-01-10', 50000, null, 0),
  ('40000000-0000-0000-0000-00000000b002', '40000000-0000-0000-0000-00000000a001', '2027-02-10', 50000, '2027-02-09', 10000),
  ('40000000-0000-0000-0000-00000000b005', '40000000-0000-0000-0000-00000000a001', '2027-03-10', 0, null, 0),
  ('40000000-0000-0000-0000-00000000b006', '40000000-0000-0000-0000-00000000a001', '2027-04-10', 1000, null, 1500),
  ('40000000-0000-0000-0000-00000000b003', '40000000-0000-0000-0000-00000000a002', '2027-01-10', 20000, null, 5000),
  ('40000000-0000-0000-0000-00000000b004', '40000000-0000-0000-0000-00000000a003', '2027-01-10', 30000, null, 0),
  ('40000000-0000-0000-0000-00000000b007', '40000000-0000-0000-0000-00000000a005', '2027-05-10', 9223372036854775807, null, 9223372036854775807);

-- Estrutura: RLS ligado, anon sem privilégio, view security_invoker, execução do RPC fechada ao anon.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['itens_financeiros', 'parcelas'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_tabela)::regclass) then
      raise exception 'FALHA: RLS desligado em %', v_tabela;
    end if;
    if has_table_privilege('anon', 'public.' || v_tabela, 'select,insert,update,delete') then
      raise exception 'FALHA: anon tem privilégio em %', v_tabela;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.parcelas_situacao', 'select') then
    raise exception 'FALHA: anon tem privilégio em parcelas_situacao';
  end if;
  if not coalesce((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.parcelas_situacao'::regclass), false) then
    raise exception 'FALHA: parcelas_situacao não é security_invoker';
  end if;
  if has_function_privilege('anon', 'public.nome_fornecedor(uuid)', 'execute') then
    raise exception 'FALHA: anon executa nome_fornecedor';
  end if;
  if not has_function_privilege('authenticated', 'public.nome_fornecedor(uuid)', 'execute') then
    raise exception 'FALHA: authenticated não executa nome_fornecedor';
  end if;
end $$;

-- Regras da view (quitação por data OU pago >= previsto; saldo da parcela nunca negativo).
do $$
begin
  if not (select quitada from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b002') then
    raise exception 'FALHA: parcela com data deveria estar quitada';
  end if;
  if not (select quitada from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b005') then
    raise exception 'FALHA: previsto zero deveria estar quitada';
  end if;
  if (select quitada from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b003') then
    raise exception 'FALHA: pagamento parcial sem data não deveria estar quitada';
  end if;
  if (select saldo_centavos from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b003') <> 15000 then
    raise exception 'FALHA: saldo da parcela parcial deveria ser 15000';
  end if;
  if not (select quitada from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b006')
     or (select saldo_centavos from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b006') <> 0 then
    raise exception 'FALHA: excesso deveria estar quitada com saldo de parcela 0';
  end if;
  if (select valor_contratado_centavos::text from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a005') <> '9223372036854775807' then
    raise exception 'FALHA: cast para texto do bigint máximo perdeu precisão';
  end if;
end $$;

-- Anon: nada.
set local role anon;
do $$
begin
  begin
    perform 1 from public.itens_financeiros;
    raise exception 'FALHA: anon conseguiu ler itens_financeiros';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.parcelas;
    raise exception 'FALHA: anon conseguiu ler parcelas';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.parcelas_situacao;
    raise exception 'FALHA: anon conseguiu ler parcelas_situacao';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.nome_fornecedor('40000000-0000-0000-0000-000000000f01');
    raise exception 'FALHA: anon conseguiu chamar nome_fornecedor';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos)
    values ('40000000-0000-0000-0000-000000000e01', 'Anon', 1);
    raise exception 'FALHA: anon conseguiu inserir item';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Cliente A: itens e parcelas só do empreendimento A, nome só do fornecedor do seu item,
-- nenhuma leitura de fornecedores e nenhuma escrita.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.itens_financeiros) <> 3
     or exists (select 1 from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a003') then
    raise exception 'FALHA: cliente A deveria ver só os 3 itens do empreendimento A';
  end if;
  if (select count(*) from public.parcelas) <> 6 or exists (select 1 from public.parcelas where id = '40000000-0000-0000-0000-00000000b004') then
    raise exception 'FALHA: cliente A deveria ver só as 6 parcelas do empreendimento A';
  end if;
  if (select count(*) from public.parcelas_situacao) <> 6 then
    raise exception 'FALHA: cliente A deveria ver 6 linhas em parcelas_situacao';
  end if;
  if (select valor_contratado_centavos::text from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a005') <> '9223372036854775807' then
    raise exception 'FALHA: cliente A não leu o bigint máximo sem perda';
  end if;
  if (select count(*) from public.fornecedores) <> 0 then
    raise exception 'FALHA: cliente A leu a tabela fornecedores';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f01') is distinct from 'Fornecedor A Fantasia Teste' then
    raise exception 'FALHA: cliente A deveria receber o nome do fornecedor do seu item';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f02') is not null then
    raise exception 'FALHA: cliente A recebeu o nome do fornecedor de outro empreendimento';
  end if;

  begin
    insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos)
    values ('40000000-0000-0000-0000-000000000e01', 'Intruso', 1);
    raise exception 'FALHA: cliente conseguiu inserir item';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.parcelas (item_id, vencimento, valor_previsto_centavos)
    values ('40000000-0000-0000-0000-00000000a001', '2027-06-10', 1);
    raise exception 'FALHA: cliente conseguiu inserir parcela';
  exception when insufficient_privilege then null;
  end;

  update public.parcelas set valor_pago_centavos = 50000, data_pagamento = '2027-01-01'
  where id = '40000000-0000-0000-0000-00000000b001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'FALHA: cliente atualizou parcela'; end if;
  update public.itens_financeiros set valor_contratado_centavos = 1 where id = '40000000-0000-0000-0000-00000000a001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'FALHA: cliente atualizou item'; end if;
  delete from public.parcelas where id = '40000000-0000-0000-0000-00000000b001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'FALHA: cliente apagou parcela'; end if;
  delete from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'FALHA: cliente apagou item'; end if;
end $$;

-- Cliente B: só o empreendimento B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a003') then
    raise exception 'FALHA: cliente B deveria ver só o item do empreendimento B';
  end if;
  if (select count(*) from public.parcelas) <> 1 or (select count(*) from public.parcelas_situacao) <> 1 then
    raise exception 'FALHA: cliente B deveria ver só a parcela do empreendimento B';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: cliente B recebeu o nome do fornecedor A';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f02') is distinct from 'Fornecedor B Razão Teste' then
    raise exception 'FALHA: cliente B deveria receber a razão social quando não há nome fantasia';
  end if;
end $$;

-- Conta com troca de senha pendente, conta inativa e empreiteiro: nada.
do $$
declare
  v_sub text;
begin
  foreach v_sub in array array[
    '40000000-0000-0000-0000-0000000000c3',
    '40000000-0000-0000-0000-0000000000c4',
    '40000000-0000-0000-0000-0000000000b1'
  ] loop
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_sub, 'role', 'authenticated')::text, true);
    if (select count(*) from public.itens_financeiros) <> 0
       or (select count(*) from public.parcelas) <> 0
       or (select count(*) from public.parcelas_situacao) <> 0
       or (select count(*) from public.fornecedores) <> 0 then
      raise exception 'FALHA: conta % não deveria ver financeiro', v_sub;
    end if;
    if public.nome_fornecedor('40000000-0000-0000-0000-000000000f01') is not null then
      raise exception 'FALHA: conta % recebeu nome de fornecedor', v_sub;
    end if;
  end loop;
end $$;

-- Fornecedor A: só o item dele (e suas parcelas); sem escrita; nome só do próprio cadastro.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: fornecedor A deveria ver só o item a001';
  end if;
  if (select count(*) from public.parcelas) <> 4 or (select count(*) from public.parcelas_situacao) <> 4 then
    raise exception 'FALHA: fornecedor A deveria ver só as 4 parcelas do item a001';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f02') is not null then
    raise exception 'FALHA: fornecedor A recebeu o nome do fornecedor B';
  end if;
  update public.parcelas set valor_pago_centavos = 1 where id = '40000000-0000-0000-0000-00000000b001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'FALHA: fornecedor atualizou parcela'; end if;
  begin
    insert into public.parcelas (item_id, vencimento, valor_previsto_centavos)
    values ('40000000-0000-0000-0000-00000000a001', '2027-06-10', 1);
    raise exception 'FALHA: fornecedor conseguiu inserir parcela';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Fornecedor B: só o item a003.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a003')
     or (select count(*) from public.parcelas) <> 1 then
    raise exception 'FALHA: fornecedor B deveria ver só o item e a parcela do empreendimento B';
  end if;
end $$;

-- Fornecedor A inativo: perde o acesso.
reset role;
update public.fornecedores set ativo = false where id = '40000000-0000-0000-0000-000000000f01';
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.itens_financeiros) <> 0 or (select count(*) from public.parcelas) <> 0 then
    raise exception 'FALHA: fornecedor A inativo não deveria ver financeiro';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: fornecedor A inativo recebeu nome';
  end if;
end $$;

reset role;
update public.fornecedores set ativo = true where id = '40000000-0000-0000-0000-000000000f01';

-- Equipe: lê tudo, grava, valida constraints, deixa auditoria com ator, lê fornecedores para o seletor.
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  -- A equipe também enxerga dados reais do banco: conta só as fixtures deste teste.
  if (select count(*) from public.itens_financeiros where id::text like '40000000-%') <> 4
     or (select count(*) from public.parcelas where id::text like '40000000-%') <> 7 then
    raise exception 'FALHA: equipe deveria ver todos os itens e parcelas';
  end if;
  -- Só os fornecedores de teste: produção já tem fornecedores reais (09/11).
  if (select count(*) from public.fornecedores where id::text like '40000000-%') <> 2
     or public.nome_fornecedor('40000000-0000-0000-0000-000000000f02') is distinct from 'Fornecedor B Razão Teste' then
    raise exception 'FALHA: equipe deveria ler fornecedores e nomes';
  end if;

  insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
  values ('40000000-0000-0000-0000-00000000a009', '40000000-0000-0000-0000-000000000e01', null, 'Item sem fornecedor da equipe', 1000);
  insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos)
  values ('40000000-0000-0000-0000-00000000b009', '40000000-0000-0000-0000-00000000a009', '2027-07-10', 1000);

  -- Pagamento acumulado, absoluto: repetir o mesmo update não soma de novo.
  update public.parcelas set valor_pago_centavos = 400 where id = '40000000-0000-0000-0000-00000000b009';
  update public.parcelas set valor_pago_centavos = 400 where id = '40000000-0000-0000-0000-00000000b009';
  if (select valor_pago_centavos from public.parcelas where id = '40000000-0000-0000-0000-00000000b009') <> 400 then
    raise exception 'FALHA: valor pago acumulado deveria permanecer 400';
  end if;
  if (select quitada from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b009') then
    raise exception 'FALHA: pagamento parcial não deveria quitar';
  end if;
  update public.parcelas set data_pagamento = '2027-07-09' where id = '40000000-0000-0000-0000-00000000b009';
  if not (select quitada from public.parcelas_situacao where id = '40000000-0000-0000-0000-00000000b009') then
    raise exception 'FALHA: informar a data deveria quitar a parcela';
  end if;

  begin
    insert into public.parcelas (item_id, vencimento, valor_previsto_centavos)
    values ('40000000-0000-0000-0000-00000000a009', '2027-08-10', -1);
    raise exception 'FALHA: previsto negativo aceito';
  exception when check_violation then null;
  end;
  begin
    update public.parcelas set valor_pago_centavos = -1 where id = '40000000-0000-0000-0000-00000000b009';
    raise exception 'FALHA: pago negativo aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos)
    values ('40000000-0000-0000-0000-000000000e01', 'Negativo', -1);
    raise exception 'FALHA: contratado negativo aceito';
  exception when check_violation then null;
  end;
  begin
    insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos)
    values ('40000000-0000-0000-0000-000000000e01', 'Acima do bigint', 9223372036854775808);
    raise exception 'FALHA: valor acima de bigint aceito';
  exception when numeric_value_out_of_range then null;
  end;

  -- Excluir o item leva as parcelas por cascade.
  delete from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a009';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 or exists (select 1 from public.parcelas where item_id = '40000000-0000-0000-0000-00000000a009') then
    raise exception 'FALHA: exclusão do item não removeu as parcelas';
  end if;
end $$;

-- RPC de exclusão da API: recusa item com pagamento, apaga o sem pagamento (com as parcelas) e devolve null se não existe.
do $$
declare
  v_resultado uuid;
begin
  insert into public.itens_financeiros (id, empreendimento_id, descricao, valor_contratado_centavos)
  values ('40000000-0000-0000-0000-00000000a010', '40000000-0000-0000-0000-000000000e01', 'Item sem pagamento', 1000),
         ('40000000-0000-0000-0000-00000000a011', '40000000-0000-0000-0000-000000000e01', 'Item com pagamento', 1000);
  insert into public.parcelas (item_id, vencimento, valor_previsto_centavos, valor_pago_centavos)
  values ('40000000-0000-0000-0000-00000000a010', '2027-07-10', 1000, 0),
         ('40000000-0000-0000-0000-00000000a011', '2027-07-10', 1000, 1);

  begin
    perform public.excluir_item_financeiro_portal('40000000-0000-0000-0000-00000000a011');
    raise exception 'FALHA: RPC apagou item com pagamento';
  exception when foreign_key_violation then null;
  end;
  if not exists (select 1 from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a011')
     or not exists (select 1 from public.parcelas where item_id = '40000000-0000-0000-0000-00000000a011') then
    raise exception 'FALHA: item com pagamento deveria permanecer com as parcelas';
  end if;

  v_resultado := public.excluir_item_financeiro_portal('40000000-0000-0000-0000-00000000a010');
  if v_resultado is distinct from '40000000-0000-0000-0000-00000000a010'
     or exists (select 1 from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a010')
     or exists (select 1 from public.parcelas where item_id = '40000000-0000-0000-0000-00000000a010') then
    raise exception 'FALHA: RPC não apagou item sem pagamento com as parcelas';
  end if;
  if public.excluir_item_financeiro_portal('40000000-0000-0000-0000-00000000a010') is not null then
    raise exception 'FALHA: RPC deveria devolver null para item inexistente';
  end if;
  delete from public.itens_financeiros where id = '40000000-0000-0000-0000-00000000a011';
end $$;

-- A auditoria só é legível pelo admin; confere como postgres que o ator da sessão foi gravado.
reset role;
do $$
begin
  if not exists (
    select 1 from public.auditoria
    where tabela = 'parcelas' and registro_id = '40000000-0000-0000-0000-00000000b009'
      and acao = 'UPDATE' and ator_id = '40000000-0000-0000-0000-0000000000e1'
  ) then
    raise exception 'FALHA: update de parcela sem auditoria com o ator da sessão';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'itens_financeiros' and registro_id = '40000000-0000-0000-0000-00000000a009'
      and acao = 'DELETE' and ator_id = '40000000-0000-0000-0000-0000000000e1'
  ) then
    raise exception 'FALHA: exclusão de item sem auditoria com o ator da sessão';
  end if;
end $$;

-- Admin também grava.
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  update public.itens_financeiros set observacao = 'Editado pelo admin' where id = '40000000-0000-0000-0000-00000000a002';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then raise exception 'FALHA: admin não atualizou item'; end if;
end $$;

-- Vínculo removido revoga a leitura do cliente imediatamente.
reset role;
delete from public.empreendimento_clientes
where empreendimento_id = '40000000-0000-0000-0000-000000000e01' and profile_id = '40000000-0000-0000-0000-0000000000c1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.itens_financeiros) <> 0 or (select count(*) from public.parcelas) <> 0 then
    raise exception 'FALHA: cliente A desvinculado ainda vê financeiro';
  end if;
  if public.nome_fornecedor('40000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: cliente A desvinculado ainda recebe nome de fornecedor';
  end if;
end $$;

reset role;

select 'OK: todas as verificações de RLS da Etapa 4 (financeiro) passaram' as resultado;

rollback;
