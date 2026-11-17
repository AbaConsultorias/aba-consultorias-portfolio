-- Testes da Etapa 7, frente B — revisões de documento (D7) e grupos contratos/orçamentos (D8).
-- Como rodar: depois de aplicar TODAS as migrations, incluindo 20261103100000_etapa7_conector.sql, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa7_revisoes.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa7_revisoes.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids com prefixo 71000000-...):
--   empreendimento A (e01, cliente c1) e B (e02, cliente c2); projeto A (a01); empreiteiro (b1), equipe (e1);
--   cadeia de revisões em A: d001 (liberado) <- d002 (oculto) <- d003 (oculto);
--   d010 liberado sem relação com a cadeia; d020 contratos liberado, d021 orçamentos oculto (ambos em A,
--   sem projeto); d022 contratos liberado em B.

begin;

insert into auth.users (id, aud, role, email)
values
  ('71000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e7r-cliente-a@example.com'),
  ('71000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'e7r-cliente-b@example.com'),
  ('71000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e7r-empreiteiro@example.com'),
  ('71000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e7r-equipe@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('71000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente A Teste E7R', true, false),
  ('71000000-0000-0000-0000-0000000000c2', 'cliente', 'Cliente B Teste E7R', true, false),
  ('71000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste E7R', true, false),
  ('71000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste E7R', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['71000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome)
values
  ('71000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste E7R'),
  ('71000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste E7R');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('71000000-0000-0000-0000-000000000e01', '71000000-0000-0000-0000-0000000000c1'),
  ('71000000-0000-0000-0000-000000000e02', '71000000-0000-0000-0000-0000000000c2');

insert into public.projetos (id, empreendimento_id, nome)
values ('71000000-0000-0000-0000-000000000a01', '71000000-0000-0000-0000-000000000e01', 'Projeto A Teste E7R');

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente, substitui_id, grupo)
values
  ('71000000-0000-0000-0000-00000000d001', '71000000-0000-0000-0000-000000000e01', 'Versão 1',
   '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d001.pdf', 'application/pdf', 100, true, null, null),
  ('71000000-0000-0000-0000-00000000d002', '71000000-0000-0000-0000-000000000e01', 'Versão 2',
   '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d002.pdf', 'application/pdf', 100, false, '71000000-0000-0000-0000-00000000d001', null),
  ('71000000-0000-0000-0000-00000000d003', '71000000-0000-0000-0000-000000000e01', 'Versão 3',
   '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d003.pdf', 'application/pdf', 100, false, '71000000-0000-0000-0000-00000000d002', null),
  ('71000000-0000-0000-0000-00000000d010', '71000000-0000-0000-0000-000000000e01', 'Sem relação',
   '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d010.pdf', 'application/pdf', 100, true, null, null),
  ('71000000-0000-0000-0000-00000000d020', '71000000-0000-0000-0000-000000000e01', 'Contrato A',
   '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d020.pdf', 'application/pdf', 100, true, null, 'contratos'),
  ('71000000-0000-0000-0000-00000000d021', '71000000-0000-0000-0000-000000000e01', 'Orçamento A',
   '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d021.pdf', 'application/pdf', 100, false, null, 'orcamentos'),
  ('71000000-0000-0000-0000-00000000d022', '71000000-0000-0000-0000-000000000e02', 'Contrato B',
   '71000000-0000-0000-0000-000000000e02/71000000-0000-0000-0000-00000000d022.pdf', 'application/pdf', 100, true, null, 'contratos');

-- Restrições (como postgres).
do $$
begin
  begin
    insert into public.documentos (empreendimento_id, projeto_id, titulo, storage_path, mime, tamanho, grupo)
    values ('71000000-0000-0000-0000-000000000e01', '71000000-0000-0000-0000-000000000a01', 'Grupo com projeto',
            '71000000-0000-0000-0000-000000000e01/grupo-com-projeto.pdf', 'application/pdf', 100, 'contratos');
    raise exception 'FALHA: grupo com projeto_id preenchido aceito';
  exception when check_violation then
    null;
  end;
  begin
    update public.documentos set projeto_id = '71000000-0000-0000-0000-000000000a01'
     where id = '71000000-0000-0000-0000-00000000d020';
    raise exception 'FALHA: documento com grupo recebeu projeto_id';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho, grupo)
    values ('71000000-0000-0000-0000-000000000e01', 'Grupo inválido',
            '71000000-0000-0000-0000-000000000e01/grupo-invalido.pdf', 'application/pdf', 100, 'outro');
    raise exception 'FALHA: grupo inválido aceito em documentos';
  exception when check_violation then
    null;
  end;

  -- Documento de projeto continua sem grupo; grupo vazio (null) com projeto é o caso comum.
  insert into public.documentos (id, empreendimento_id, projeto_id, titulo, storage_path, mime, tamanho)
  values ('71000000-0000-0000-0000-00000000d030', '71000000-0000-0000-0000-000000000e01', '71000000-0000-0000-0000-000000000a01',
          'De projeto', '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d030.pdf', 'application/pdf', 100);

  -- Revisão: mesmo empreendimento, sem autorreferência, sem reapontar.
  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho, substitui_id)
    values ('71000000-0000-0000-0000-000000000e02', 'Revisão cruzada',
            '71000000-0000-0000-0000-000000000e02/revisao-cruzada.pdf', 'application/pdf', 100,
            '71000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: revisão de documento de outro empreendimento aceita';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, substitui_id)
    values ('71000000-0000-0000-0000-00000000d099', '71000000-0000-0000-0000-000000000e01', 'Autorreferência',
            '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d099.pdf', 'application/pdf', 100,
            '71000000-0000-0000-0000-00000000d099');
    raise exception 'FALHA: documento substituindo a si mesmo aceito';
  exception when check_violation then
    null;
  end;
  begin
    update public.documentos set substitui_id = '71000000-0000-0000-0000-00000000d003'
     where id = '71000000-0000-0000-0000-00000000d001';
    raise exception 'FALHA: ciclo de revisões aceito (d001 passou a substituir d003)';
  exception when check_violation then
    null;
  end;
  begin
    update public.documentos set substitui_id = '71000000-0000-0000-0000-00000000d001'
     where id = '71000000-0000-0000-0000-00000000d003';
    raise exception 'FALHA: revisão reapontada';
  exception when check_violation then
    null;
  end;

  -- Apagar a anterior solta a nova (ON DELETE SET NULL) sem apagar nem liberar nada.
  insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente)
  values ('71000000-0000-0000-0000-00000000d040', '71000000-0000-0000-0000-000000000e01', 'Anterior',
          '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d040.pdf', 'application/pdf', 100, true);
  insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, substitui_id)
  values ('71000000-0000-0000-0000-00000000d041', '71000000-0000-0000-0000-000000000e01', 'Nova',
          '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d041.pdf', 'application/pdf', 100,
          '71000000-0000-0000-0000-00000000d040');
  delete from public.documentos where id = '71000000-0000-0000-0000-00000000d040';
  if (select substitui_id from public.documentos where id = '71000000-0000-0000-0000-00000000d041') is not null
     or (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d041') then
    raise exception 'FALHA: apagar a anterior deveria soltar a revisão, oculta';
  end if;
  delete from public.documentos where id = '71000000-0000-0000-0000-00000000d041';

  if has_function_privilege('anon', 'public.liberar_revisao_documento(uuid)', 'execute')
     or has_function_privilege('public', 'public.liberar_revisao_documento(uuid)', 'execute') then
    raise exception 'FALHA: anon/public podem executar liberar_revisao_documento';
  end if;
  if not has_function_privilege('authenticated', 'public.liberar_revisao_documento(uuid)', 'execute') then
    raise exception 'FALHA: authenticated não executa liberar_revisao_documento';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cliente A: vê a versão anterior (e os grupos liberados), nunca a revisão oculta.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select array_agg(id order by id) from public.documentos where id::text like '71000000%')
     is distinct from array[
       '71000000-0000-0000-0000-00000000d001', '71000000-0000-0000-0000-00000000d010',
       '71000000-0000-0000-0000-00000000d020'
     ]::uuid[] then
    raise exception 'FALHA: cliente A deveria ver d001 (anterior), d010 e d020, viu %',
      (select array_agg(right(id::text, 4) order by id) from public.documentos where id::text like '71000000%');
  end if;
  if exists (select 1 from public.documentos where id in (
    '71000000-0000-0000-0000-00000000d002', '71000000-0000-0000-0000-00000000d003',
    '71000000-0000-0000-0000-00000000d021', '71000000-0000-0000-0000-00000000d022', '71000000-0000-0000-0000-00000000d030')) then
    raise exception 'FALHA: cliente A vê revisão oculta, orçamento oculto ou documento de outro empreendimento';
  end if;
  -- Contrato (grupo, sem projeto) liberado aparece com o grupo.
  if (select grupo from public.documentos where id = '71000000-0000-0000-0000-00000000d020') is distinct from 'contratos' then
    raise exception 'FALHA: cliente A não lê o contrato liberado do empreendimento (grupo)';
  end if;
end $$;

-- Cliente B: só o contrato do empreendimento B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  if (select array_agg(id order by id) from public.documentos where id::text like '71000000%')
     is distinct from array['71000000-0000-0000-0000-00000000d022']::uuid[] then
    raise exception 'FALHA: cliente B deveria ver só d022';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Quem não é da equipe não libera revisão.
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform public.liberar_revisao_documento('71000000-0000-0000-0000-00000000d002');
    raise exception 'FALHA: anon executou liberar_revisao_documento';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  begin
    perform public.liberar_revisao_documento('71000000-0000-0000-0000-00000000d002');
    raise exception 'FALHA: cliente executou liberar_revisao_documento';
  exception when insufficient_privilege then
    null;
  end;
  update public.documentos set liberado_cliente = true where id = '71000000-0000-0000-0000-00000000d002';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente liberou revisão por UPDATE direto';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
begin
  begin
    perform public.liberar_revisao_documento('71000000-0000-0000-0000-00000000d002');
    raise exception 'FALHA: empreiteiro executou liberar_revisao_documento';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
do $$
begin
  if (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d002')
     or not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d001') then
    raise exception 'FALHA: tentativas de não-staff alteraram a cadeia de revisões';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Equipe: a função troca as duas na mesma transação; idempotente; erros claros.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_em timestamptz;
begin
  perform public.liberar_revisao_documento('71000000-0000-0000-0000-00000000d002');

  if not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d002')
     or (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d001')
     or (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d003') then
    raise exception 'FALHA: liberar_revisao_documento deveria deixar só a v2 liberada';
  end if;
  if (select liberado_por from public.documentos where id = '71000000-0000-0000-0000-00000000d002')
       is distinct from '71000000-0000-0000-0000-0000000000e1'::uuid
     or (select liberado_em from public.documentos where id = '71000000-0000-0000-0000-00000000d002') is null then
    raise exception 'FALHA: a revisão liberada deveria carregar quem liberou e quando';
  end if;
  if (select liberado_por from public.documentos where id = '71000000-0000-0000-0000-00000000d001') is not null then
    raise exception 'FALHA: a versão ocultada deveria perder o carimbo de liberação';
  end if;
  if not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d010') then
    raise exception 'FALHA: documento sem relação com a cadeia foi ocultado';
  end if;

  -- Idempotente: de novo não muda nada (nem o carimbo).
  select liberado_em into v_em from public.documentos where id = '71000000-0000-0000-0000-00000000d002';
  perform public.liberar_revisao_documento('71000000-0000-0000-0000-00000000d002');
  if (select liberado_em from public.documentos where id = '71000000-0000-0000-0000-00000000d002') is distinct from v_em
     or not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d002')
     or (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d001') then
    raise exception 'FALHA: liberar_revisao_documento não é idempotente';
  end if;

  begin
    perform public.liberar_revisao_documento('71000000-0000-0000-0000-00000000d010');
    raise exception 'FALHA: liberar_revisao_documento aceitou documento que não é revisão';
  exception when check_violation then
    null;
  end;
  begin
    perform public.liberar_revisao_documento('71000000-0000-0000-0000-0000000000ff');
    raise exception 'FALHA: liberar_revisao_documento aceitou documento inexistente';
  exception when sqlstate 'P0002' then
    null;
  end;
end $$;

-- Depois da liberação: o cliente A vê a v2 no lugar da v1.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select array_agg(id order by id) from public.documentos where id::text like '71000000%')
     is distinct from array[
       '71000000-0000-0000-0000-00000000d002', '71000000-0000-0000-0000-00000000d010', '71000000-0000-0000-0000-00000000d020'
     ]::uuid[] then
    raise exception 'FALHA: depois de liberar, o cliente A deveria ver d002, d010 e d020 (nunca duas versões), viu %',
      (select array_agg(right(id::text, 4) order by id) from public.documentos where id::text like '71000000%');
  end if;
end $$;

-- Equipe liberando por UPDATE direto (sem a função): o banco também impede duas versões visíveis.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_visiveis uuid[];
begin
  -- v3 liberada por UPDATE: a v2 sai.
  update public.documentos set liberado_cliente = true where id = '71000000-0000-0000-0000-00000000d003';
  select array_agg(id order by id) into v_visiveis from public.documentos
   where liberado_cliente and id in ('71000000-0000-0000-0000-00000000d001', '71000000-0000-0000-0000-00000000d002', '71000000-0000-0000-0000-00000000d003');
  if v_visiveis is distinct from array['71000000-0000-0000-0000-00000000d003']::uuid[] then
    raise exception 'FALHA: UPDATE liberando a v3 deveria deixar só a v3 visível, ficaram %', v_visiveis;
  end if;

  -- Voltar à v1 (a raiz) também esconde as novas.
  update public.documentos set liberado_cliente = true where id = '71000000-0000-0000-0000-00000000d001';
  select array_agg(id order by id) into v_visiveis from public.documentos
   where liberado_cliente and id in ('71000000-0000-0000-0000-00000000d001', '71000000-0000-0000-0000-00000000d002', '71000000-0000-0000-0000-00000000d003');
  if v_visiveis is distinct from array['71000000-0000-0000-0000-00000000d001']::uuid[] then
    raise exception 'FALHA: UPDATE liberando a v1 deveria deixar só a v1 visível, ficaram %', v_visiveis;
  end if;

  -- Liberação automática: a v4 já entra liberada e esconde toda a cadeia anterior, não só a vizinha.
  insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente, substitui_id)
  values ('71000000-0000-0000-0000-00000000d004', '71000000-0000-0000-0000-000000000e01', 'Versão 4',
          '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d004.pdf', 'application/pdf', 100, true,
          '71000000-0000-0000-0000-00000000d003');
  select array_agg(id order by id) into v_visiveis from public.documentos
   where liberado_cliente and id in ('71000000-0000-0000-0000-00000000d001', '71000000-0000-0000-0000-00000000d002',
                                     '71000000-0000-0000-0000-00000000d003', '71000000-0000-0000-0000-00000000d004');
  if v_visiveis is distinct from array['71000000-0000-0000-0000-00000000d004']::uuid[] then
    raise exception 'FALHA: INSERT já liberado deveria deixar só a v4 visível, ficaram %', v_visiveis;
  end if;

  -- Orçamento (grupo) liberado: aparece, e não mexe em documentos sem relação.
  update public.documentos set liberado_cliente = true where id = '71000000-0000-0000-0000-00000000d021';
  if not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d020')
     or not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d010')
     or not (select liberado_cliente from public.documentos where id = '71000000-0000-0000-0000-00000000d021') then
    raise exception 'FALHA: liberar um orçamento mexeu em outros documentos';
  end if;

  -- Ocultar não reabre nada.
  update public.documentos set liberado_cliente = false where id = '71000000-0000-0000-0000-00000000d004';
  if exists (select 1 from public.documentos where liberado_cliente
             and id in ('71000000-0000-0000-0000-00000000d001', '71000000-0000-0000-0000-00000000d002', '71000000-0000-0000-0000-00000000d003')) then
    raise exception 'FALHA: ocultar a v4 reabriu uma versão anterior';
  end if;
  update public.documentos set liberado_cliente = true where id = '71000000-0000-0000-0000-00000000d004';
end $$;

-- Cliente A no fim: v4, d010, contrato e orçamento liberados (D8); cliente B continua só com o dele.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select array_agg(id order by id) from public.documentos where id::text like '71000000%')
     is distinct from array[
       '71000000-0000-0000-0000-00000000d004', '71000000-0000-0000-0000-00000000d010',
       '71000000-0000-0000-0000-00000000d020', '71000000-0000-0000-0000-00000000d021'
     ]::uuid[] then
    raise exception 'FALHA: cliente A deveria ver d004, d010, d020 e d021, viu %',
      (select array_agg(right(id::text, 4) order by id) from public.documentos where id::text like '71000000%');
  end if;
  if (select count(*) from public.documentos where grupo is not null) <> 2 then
    raise exception 'FALHA: cliente A deveria ver 2 documentos de grupo (contratos e orçamentos)';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  if (select array_agg(id order by id) from public.documentos where id::text like '71000000%')
     is distinct from array['71000000-0000-0000-0000-00000000d022']::uuid[] then
    raise exception 'FALHA: cliente B passou a ver documento de outro empreendimento';
  end if;
end $$;

select 'OK: revisões e grupos da Etapa 7 passaram nos testes' as resultado;

rollback;
