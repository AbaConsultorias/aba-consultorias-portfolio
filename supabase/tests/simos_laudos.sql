-- Testes de SIMOS e Laudos por equipamento (migration 20261110100000_simos_laudos.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/simos_laudos.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/simos_laudos.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
-- O teste insere o próprio conector ativo: o banco não pode ter outro conector ativo (índice conectores_um_ativo_idx).
--
-- Fixture (ids com prefixo 73000000-...):
--   empreendimentos A (e01) e B (e02); cliente c1 de A e cliente c2 de B;
--   projeto a01 (A) com categorias 'SIMOS' e 'laudos' (caixa diferente de propósito); a02 (A) só com 'Laudos';
--   a03 (A) com as duas (a categoria Laudos é apagada no meio do teste); b01 (B) com as duas;
--   regras: a1 comum (grupo contratos), a2 equipamentos (projeto a01), a3 equipamentos (projeto a03),
--   a4 comum (projeto a01, categoria 'laudos').

begin;

update public.conectores set revogado_em = now() where revogado_em is null;

insert into auth.users (id, aud, role, email)
values
  ('73000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'simos-cliente-a@example.com'),
  ('73000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'simos-cliente-b@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('73000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente A Teste SIMOS', true, false),
  ('73000000-0000-0000-0000-0000000000c2', 'cliente', 'Cliente B Teste SIMOS', true, false);

insert into public.empreendimentos (id, nome, codigo_pasta)
values
  ('73000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste SIMOS', '737301'),
  ('73000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste SIMOS', '737302');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('73000000-0000-0000-0000-000000000e01', '73000000-0000-0000-0000-0000000000c1'),
  ('73000000-0000-0000-0000-000000000e02', '73000000-0000-0000-0000-0000000000c2');

insert into public.projetos (id, empreendimento_id, nome)
values
  ('73000000-0000-0000-0000-000000000a01', '73000000-0000-0000-0000-000000000e01', 'Ordem de Serviço A'),
  ('73000000-0000-0000-0000-000000000a02', '73000000-0000-0000-0000-000000000e01', 'Projeto sem SIMOS'),
  ('73000000-0000-0000-0000-000000000a03', '73000000-0000-0000-0000-000000000e01', 'Ordem de Serviço descartável'),
  ('73000000-0000-0000-0000-000000000b01', '73000000-0000-0000-0000-000000000e02', 'Ordem de Serviço B');

insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values
  ('73000000-0000-0000-0000-000000000ca1', '73000000-0000-0000-0000-000000000a01', 'SIMOS', 1),
  ('73000000-0000-0000-0000-000000000ca2', '73000000-0000-0000-0000-000000000a01', 'laudos', 2),
  ('73000000-0000-0000-0000-000000000ca3', '73000000-0000-0000-0000-000000000a02', 'Laudos', 1),
  ('73000000-0000-0000-0000-000000000ca4', '73000000-0000-0000-0000-000000000a03', 'SIMOS', 1),
  ('73000000-0000-0000-0000-000000000ca5', '73000000-0000-0000-0000-000000000a03', 'Laudos', 2),
  ('73000000-0000-0000-0000-000000000cb1', '73000000-0000-0000-0000-000000000b01', 'SIMOS', 1),
  ('73000000-0000-0000-0000-000000000cb2', '73000000-0000-0000-0000-000000000b01', 'Laudos', 2);

insert into public.conectores (id, nome, token_hash)
values ('73000000-0000-0000-0000-000000000c01', 'Conector teste SIMOS', repeat('a', 64));

-- Erro esperado: o bloco executa o SQL e confere o código e um trecho da mensagem.
create function pg_temp.espera_erro(p_sql text, p_estado text, p_trecho text)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  raise exception 'FALHA-SEM-ERRO: esperava % em: %', p_estado, p_sql;
exception when others then
  if sqlerrm like 'FALHA-SEM-ERRO:%' then
    raise exception 'FALHA: %', sqlerrm;
  end if;
  if sqlstate <> p_estado or position(p_trecho in sqlerrm) = 0 then
    raise exception 'FALHA: erro inesperado (% / %) em: % (esperava % com "%")', sqlstate, sqlerrm, p_sql, p_estado, p_trecho;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. pasta_regras.tipo
-- ---------------------------------------------------------------------------

insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo)
values ('73000000-0000-0000-0000-0000000000a1', '73000000-0000-0000-0000-000000000e01', '01 - TESTE', 'contratos');

do $$
begin
  if (select tipo from public.pasta_regras where id = '73000000-0000-0000-0000-0000000000a1') <> 'comum' then
    raise exception 'FALHA: o padrão do tipo da regra é comum';
  end if;

  perform pg_temp.espera_erro(
    $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, tipo)
       values ('73000000-0000-0000-0000-000000000e01', 'X1', '73000000-0000-0000-0000-000000000a01', 'qualquer')$q$,
    '23514', 'pasta_regras_tipo_check');

  -- equipamentos: projeto obrigatório, sem categoria e sem grupo.
  perform pg_temp.espera_erro(
    $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo, tipo)
       values ('73000000-0000-0000-0000-000000000e01', 'X2', 'contratos', 'equipamentos')$q$,
    '23514', 'pasta_regras_equipamentos_destino_check');
  perform pg_temp.espera_erro(
    $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, categoria_id, tipo)
       values ('73000000-0000-0000-0000-000000000e01', 'X3', '73000000-0000-0000-0000-000000000a01',
               '73000000-0000-0000-0000-000000000ca1', 'equipamentos')$q$,
    '23514', 'pasta_regras_equipamentos_destino_check');

  -- O projeto precisa ter as categorias SIMOS e Laudos (sem diferenciar caixa).
  perform pg_temp.espera_erro(
    $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, tipo)
       values ('73000000-0000-0000-0000-000000000e01', 'X4', '73000000-0000-0000-0000-000000000a02', 'equipamentos')$q$,
    '23514', 'O projeto precisa ter as categorias SIMOS e Laudos.');
  perform pg_temp.espera_erro(
    $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, tipo)
       values ('73000000-0000-0000-0000-000000000e01', 'X5', '73000000-0000-0000-0000-000000000b01', 'equipamentos')$q$,
    '23514', 'Projeto não pertence ao empreendimento.');

  insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, projeto_id, tipo)
  values
    ('73000000-0000-0000-0000-0000000000a2', '73000000-0000-0000-0000-000000000e01', '19 - SIMOS E LAUDOS',
     '73000000-0000-0000-0000-000000000a01', 'equipamentos'),
    ('73000000-0000-0000-0000-0000000000a3', '73000000-0000-0000-0000-000000000e01', '18 - OUTRA',
     '73000000-0000-0000-0000-000000000a03', 'equipamentos');
  insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, projeto_id, categoria_id)
  values ('73000000-0000-0000-0000-0000000000a4', '73000000-0000-0000-0000-000000000e01', '05 - COMUM',
          '73000000-0000-0000-0000-000000000a01', '73000000-0000-0000-0000-000000000ca2');

  -- Trocar uma regra existente para um projeto sem as categorias, ou para comum -> equipamentos nele, também é recusado.
  perform pg_temp.espera_erro(
    $q$update public.pasta_regras set projeto_id = '73000000-0000-0000-0000-000000000a02'
       where id = '73000000-0000-0000-0000-0000000000a2'$q$,
    '23514', 'O projeto precisa ter as categorias SIMOS e Laudos.');
  perform pg_temp.espera_erro(
    $q$update public.pasta_regras set tipo = 'equipamentos', projeto_id = '73000000-0000-0000-0000-000000000a02', categoria_id = null
       where id = '73000000-0000-0000-0000-0000000000a4'$q$,
    '23514', 'O projeto precisa ter as categorias SIMOS e Laudos.');
  -- Mudar só o prefixo ou desativar não revalida nada e passa.
  update public.pasta_regras set ativa = false where id = '73000000-0000-0000-0000-0000000000a2';
  update public.pasta_regras set ativa = true where id = '73000000-0000-0000-0000-0000000000a2';
end
$$;

-- ---------------------------------------------------------------------------
-- 2. documentos.equipamento e documentos.equipamento_papel
-- ---------------------------------------------------------------------------

create function pg_temp.sql_documento(p_n int, p_equipamento text, p_papel text, p_projeto uuid, p_categoria uuid)
returns text
language sql
as $$
  select format(
    $f$insert into public.documentos (id, empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho, equipamento, equipamento_papel)
       values (%L, '73000000-0000-0000-0000-000000000e01', %L, %L, 'Teste', %L, 'application/pdf', 10, %L, %L)$f$,
    '73000000-0000-0000-0000-' || lpad((9000 + p_n)::text, 12, '0'), p_projeto, p_categoria,
    '73000000-0000-0000-0000-000000000e01/chk-' || p_n || '.pdf', p_equipamento, p_papel)
$$;

do $$
declare
  v_projeto constant uuid := '73000000-0000-0000-0000-000000000a01';
  v_simos constant uuid := '73000000-0000-0000-0000-000000000ca1';
begin
  perform pg_temp.espera_erro(pg_temp.sql_documento(1, 'BOMBAS', 'qualquer', v_projeto, v_simos), '23514', 'documentos_equipamento_papel_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(2, null, 'simo', v_projeto, v_simos), '23514', 'documentos_equipamento_par_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(3, 'BOMBAS', null, v_projeto, v_simos), '23514', 'documentos_equipamento_par_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(4, '', 'simo', v_projeto, v_simos), '23514', 'documentos_equipamento_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(5, 'BOM' || chr(10) || 'BAS', 'simo', v_projeto, v_simos), '23514', 'documentos_equipamento_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(6, repeat('x', 161), 'simo', v_projeto, v_simos), '23514', 'documentos_equipamento_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(7, 'BOMBAS', 'simo', v_projeto, null), '23514', 'documentos_equipamento_destino_check');
  perform pg_temp.espera_erro(pg_temp.sql_documento(8, 'BOMBAS', 'simo', null, null), '23514', 'documentos_equipamento_destino_check');

  execute pg_temp.sql_documento(9, repeat('é', 160), 'laudo', v_projeto, '73000000-0000-0000-0000-000000000ca2');
  execute pg_temp.sql_documento(10, null, null, null, null);
  if (select count(*) from public.documentos where storage_path like '%/chk-%') <> 2 then
    raise exception 'FALHA: o documento de 160 caracteres e o documento comum deviam entrar';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. confirmar_envio_conector com equipamento e papel
-- ---------------------------------------------------------------------------

-- Envio 'autorizado' como o POST /envios deixa: o documento planejado tem id derivado de p_n.
create function pg_temp.novo_envio(p_n int, p_regra uuid, p_caminho text)
returns uuid
language sql
as $$
  insert into public.conector_envios (conector_id, empreendimento_id, regra_id, caminho_relativo, tamanho, sha256, estado,
                                      storage_path, documento_planejado_id, mtime)
  values ('73000000-0000-0000-0000-000000000c01', '73000000-0000-0000-0000-000000000e01', p_regra, p_caminho, 100,
          lpad(p_n::text, 64, '0'), 'autorizado',
          '73000000-0000-0000-0000-000000000e01/73000000-0000-0000-0000-' || lpad(p_n::text, 12, '0') || '.pdf',
          ('73000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, now())
  returning id
$$;

create function pg_temp.doc(p_n int) returns uuid language sql as $$
  select ('73000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create function pg_temp.confirma(p_envio uuid, p_substitui uuid, p_equipamento text, p_papel text)
returns jsonb
language sql
as $$
  select public.confirmar_envio_conector(p_envio, '73000000-0000-0000-0000-000000000c01', 'Titulo', p_substitui, now(), p_equipamento, p_papel)
$$;

do $$
declare
  v_resultado jsonb;
  v_doc public.documentos%rowtype;
  v_envio uuid;
begin
  -- SIMO: categoria 'SIMOS' do projeto da regra, equipamento e papel gravados, chega oculto.
  v_envio := pg_temp.novo_envio(1, '73000000-0000-0000-0000-0000000000a2', '19 - SIMOS E LAUDOS/01 - BOMBAS/SIMO - Bombas.pdf');
  v_resultado := pg_temp.confirma(v_envio, null, 'BOMBAS', 'simo');
  if v_resultado->>'situacao' <> 'confirmado' or (v_resultado->>'novo')::boolean is not true then
    raise exception 'FALHA: SIMO devia confirmar agora: %', v_resultado;
  end if;
  select * into v_doc from public.documentos where id = pg_temp.doc(1);
  if v_doc.categoria_id <> '73000000-0000-0000-0000-000000000ca1' then raise exception 'FALHA: o SIMO devia ir para a categoria SIMOS'; end if;
  if v_doc.projeto_id <> '73000000-0000-0000-0000-000000000a01' then raise exception 'FALHA: o projeto devia ser o da regra'; end if;
  if v_doc.equipamento <> 'BOMBAS' or v_doc.equipamento_papel <> 'simo' then raise exception 'FALHA: equipamento/papel do SIMO'; end if;
  if v_doc.liberado_cliente then raise exception 'FALHA: o documento do servidor chega oculto'; end if;
  if not exists (select 1 from public.documento_origens where documento_id = pg_temp.doc(1)) then
    raise exception 'FALHA: o SIMO devia ter origem';
  end if;

  -- Confirmar de novo é idempotente.
  v_resultado := pg_temp.confirma(v_envio, null, 'BOMBAS', 'simo');
  if v_resultado->>'situacao' <> 'confirmado' or (v_resultado->>'novo')::boolean is not false then
    raise exception 'FALHA: repetir a confirmação devia ser idempotente: %', v_resultado;
  end if;

  -- Laudo: categoria 'laudos' (caixa diferente de 'Laudos').
  v_envio := pg_temp.novo_envio(2, '73000000-0000-0000-0000-0000000000a2', '19 - SIMOS E LAUDOS/01 - BOMBAS/LAUDO/laudo.pdf');
  v_resultado := pg_temp.confirma(v_envio, null, 'BOMBAS', 'laudo');
  select * into v_doc from public.documentos where id = pg_temp.doc(2);
  if v_doc.categoria_id <> '73000000-0000-0000-0000-000000000ca2' then raise exception 'FALHA: o Laudo devia ir para a categoria Laudos'; end if;
  if v_doc.equipamento_papel <> 'laudo' or v_doc.equipamento <> 'BOMBAS' then raise exception 'FALHA: equipamento/papel do Laudo'; end if;

  -- Revisão do SIMO: herda o equipamento (mesmo com outro nome vindo do chamador) e o papel, na mesma família.
  v_envio := pg_temp.novo_envio(3, '73000000-0000-0000-0000-0000000000a2', '19 - SIMOS E LAUDOS/01 - BOMBAS/SIMO - Bombas.pdf');
  v_resultado := pg_temp.confirma(v_envio, pg_temp.doc(1), 'Bombas renomeada', 'simo');
  select * into v_doc from public.documentos where id = pg_temp.doc(3);
  if v_doc.substitui_id is distinct from pg_temp.doc(1) then raise exception 'FALHA: a revisão devia substituir o SIMO anterior'; end if;
  if v_doc.equipamento <> 'BOMBAS' or v_doc.equipamento_papel <> 'simo' then
    raise exception 'FALHA: a revisão devia herdar equipamento e papel (%, %)', v_doc.equipamento, v_doc.equipamento_papel;
  end if;
  if v_doc.categoria_id <> '73000000-0000-0000-0000-000000000ca1' then raise exception 'FALHA: a revisão fica na categoria SIMOS'; end if;
  if v_doc.familia_id <> (select familia_id from public.documentos where id = pg_temp.doc(1)) then
    raise exception 'FALHA: a revisão devia ficar na família do SIMO';
  end if;

  -- Papel diferente do documento substituído não é revisão: entra sem anterior.
  v_envio := pg_temp.novo_envio(4, '73000000-0000-0000-0000-0000000000a2', '19 - SIMOS E LAUDOS/01 - BOMBAS/LAUDO/outro.pdf');
  v_resultado := pg_temp.confirma(v_envio, pg_temp.doc(1), 'BOMBAS', 'laudo');
  if (select substitui_id from public.documentos where id = pg_temp.doc(4)) is not null then
    raise exception 'FALHA: Laudo não pode ser revisão de SIMO';
  end if;

  -- Regra de equipamentos exige equipamento e papel válidos; regra comum não aceita nenhum dos dois.
  v_envio := pg_temp.novo_envio(5, '73000000-0000-0000-0000-0000000000a2', '19 - SIMOS E LAUDOS/02 - X/SIMO x.pdf');
  perform pg_temp.espera_erro(format('select pg_temp.confirma(%L, null, %L, null)', v_envio, 'X'), '23514', 'exige equipamento e papel');
  perform pg_temp.espera_erro(format('select pg_temp.confirma(%L, null, %L, %L)', v_envio, 'X', 'outro'), '23514', 'exige equipamento e papel');
  perform pg_temp.espera_erro(format('select pg_temp.confirma(%L, null, null, %L)', v_envio, 'simo'), '23514', 'exige equipamento e papel');
  if (select estado from public.conector_envios where id = v_envio) <> 'autorizado' then
    raise exception 'FALHA: a chamada recusada não pode mudar o envio';
  end if;

  v_envio := pg_temp.novo_envio(6, '73000000-0000-0000-0000-0000000000a4', '05 - COMUM/a.pdf');
  perform pg_temp.espera_erro(format('select pg_temp.confirma(%L, null, %L, %L)', v_envio, 'X', 'simo'), '23514', 'Regra comum não tem equipamento');
  v_resultado := pg_temp.confirma(v_envio, null, null, null);
  select * into v_doc from public.documentos where id = pg_temp.doc(6);
  if v_doc.equipamento is not null or v_doc.equipamento_papel is not null then raise exception 'FALHA: documento comum sem equipamento'; end if;
  if v_doc.categoria_id <> '73000000-0000-0000-0000-000000000ca2' then raise exception 'FALHA: regra comum usa a categoria da regra'; end if;

  -- Se o projeto perdeu a categoria do papel, nada é criado.
  delete from public.projeto_categorias_documento where id = '73000000-0000-0000-0000-000000000ca5';
  v_envio := pg_temp.novo_envio(7, '73000000-0000-0000-0000-0000000000a3', '18 - OUTRA/03 - PAINÉIS/LAUDO/laudo.pdf');
  v_resultado := pg_temp.confirma(v_envio, null, 'PAINÉIS', 'laudo');
  if v_resultado->>'situacao' <> 'sem_categoria' then raise exception 'FALHA: esperava sem_categoria: %', v_resultado; end if;
  if exists (select 1 from public.documentos where id = pg_temp.doc(7)) then raise exception 'FALHA: nenhum documento sem categoria'; end if;
  if (select estado from public.conector_envios where id = v_envio) <> 'autorizado' then raise exception 'FALHA: o envio segue autorizado'; end if;
  v_envio := pg_temp.novo_envio(8, '73000000-0000-0000-0000-0000000000a3', '18 - OUTRA/03 - PAINÉIS/SIMO painéis.pdf');
  v_resultado := pg_temp.confirma(v_envio, null, 'PAINÉIS', 'simo');
  if v_resultado->>'situacao' <> 'confirmado' then raise exception 'FALHA: a categoria SIMOS ainda existe: %', v_resultado; end if;

  -- Regra desativada continua devolvendo sem_regra.
  update public.pasta_regras set ativa = false where id = '73000000-0000-0000-0000-0000000000a2';
  v_envio := pg_temp.novo_envio(9, '73000000-0000-0000-0000-0000000000a2', '19 - SIMOS E LAUDOS/04 - Y/SIMO y.pdf');
  v_resultado := pg_temp.confirma(v_envio, null, 'Y', 'simo');
  if v_resultado->>'situacao' <> 'sem_regra' then raise exception 'FALHA: esperava sem_regra: %', v_resultado; end if;
  update public.pasta_regras set ativa = true where id = '73000000-0000-0000-0000-0000000000a2';
end
$$;

-- Assinatura única e acesso só do service_role.
do $$
begin
  if to_regprocedure('public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz)') is not null then
    raise exception 'FALHA: a assinatura antiga de confirmar_envio_conector devia ter sido removida';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'confirmar_envio_conector') <> 1 then
    raise exception 'FALHA: deve existir uma só confirmar_envio_conector';
  end if;
  if has_function_privilege('anon', 'public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)', 'execute') then
    raise exception 'FALHA: anon e authenticated não executam confirmar_envio_conector';
  end if;
  if not has_function_privilege('service_role', 'public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)', 'execute') then
    raise exception 'FALHA: service_role executa confirmar_envio_conector';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS: o cliente só enxerga documento liberado do próprio empreendimento
-- ---------------------------------------------------------------------------

-- O SIMO (doc 1) é liberado; o Laudo (doc 2) fica oculto. A revisão do SIMO (doc 3) fica oculta.
update public.documentos set liberado_cliente = true where id = pg_temp.doc(1);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"73000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- Ids literais (doc n = 73000000-0000-0000-0000-<n com 12 dígitos>): as funções de pg_temp não são chamadas com o papel authenticated.
do $$
declare
  v_linhas int;
  v_equipamento text;
begin
  select count(*) into v_linhas from public.documentos where id = '73000000-0000-0000-0000-000000000001';
  if v_linhas <> 1 then raise exception 'FALHA: o cliente de A devia ver o SIMO liberado'; end if;
  select equipamento into v_equipamento from public.documentos where id = '73000000-0000-0000-0000-000000000001';
  if v_equipamento <> 'BOMBAS' then raise exception 'FALHA: o cliente lê o equipamento do documento liberado'; end if;

  select count(*) into v_linhas from public.documentos
   where id in ('73000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000004');
  if v_linhas <> 0 then raise exception 'FALHA: o cliente não vê Laudo nem revisão não liberados'; end if;

  -- Sem escrita: nem editar o equipamento do que enxerga, nem inserir, nem chamar a função do conector.
  update public.documentos set equipamento = 'OUTRO' where id = '73000000-0000-0000-0000-000000000001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then raise exception 'FALHA: o cliente não altera documentos'; end if;

  begin
    insert into public.documentos (id, empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho, equipamento, equipamento_papel)
    values ('73000000-0000-0000-0000-000000009020', '73000000-0000-0000-0000-000000000e01', '73000000-0000-0000-0000-000000000a01',
            '73000000-0000-0000-0000-000000000ca1', 'Teste', '73000000-0000-0000-0000-000000000e01/cliente.pdf', 'application/pdf', 10,
            'BOMBAS', 'simo');
    raise exception 'FALHA: o cliente não insere documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.confirmar_envio_conector(gen_random_uuid(), gen_random_uuid(), 'x', null, now(), 'X', 'simo');
    raise exception 'FALHA: o cliente não executa confirmar_envio_conector';
  exception when insufficient_privilege then
    null;
  end;

  -- As regras do servidor (com o tipo) não são do cliente.
  select count(*) into v_linhas from public.pasta_regras;
  if v_linhas <> 0 then raise exception 'FALHA: o cliente não lê regras de pasta'; end if;
end
$$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"73000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  select count(*) into v_linhas from public.documentos
   where id in ('73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000003',
                '73000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000006', '73000000-0000-0000-0000-000000000008');
  if v_linhas <> 0 then raise exception 'FALHA: o cliente de outro empreendimento não vê nada de A'; end if;
end
$$;

reset role;

select 'OK: SIMOS e Laudos por equipamento passaram nos testes' as resultado;

rollback;
