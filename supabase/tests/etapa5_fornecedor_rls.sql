-- Testes de RLS da Etapa 5, frente B (fornecedor, contratos e documentos).
-- Como rodar: depois de aplicar TODAS as migrations (incluindo 20261031100000), use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa5_fornecedor_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script
-- para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids com prefixo 50000000-...):
--   empreendimentos A (e01), B (e02) e C (e03, sem item de fornecedor);
--   cliente A (c1) e cliente B (c2); empreiteiro (b1); equipe (e1) e admin (a1);
--   fornecedor A (f01, usuário f1 e usuário inativo f4), fornecedor B (f02, usuário f2)
--   e fornecedor C (f03, usuário f3 com troca de senha pendente).
--
-- O fornecedor nunca insere linha direto: só a RPC enviar_documento_fornecedor. Nos
-- buckets privados só a equipe lê objeto; ninguém escreve por RLS (rota de servidor).

begin;

insert into auth.users (id, aud, role, email)
values
  ('50000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e5f-cliente-a@example.com'),
  ('50000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'e5f-cliente-b@example.com'),
  ('50000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e5f-empreiteiro@example.com'),
  ('50000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e5f-fornecedor-a@example.com'),
  ('50000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'e5f-fornecedor-b@example.com'),
  ('50000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated', 'e5f-fornecedor-pendente@example.com'),
  ('50000000-0000-0000-0000-0000000000f4', 'authenticated', 'authenticated', 'e5f-fornecedor-inativo@example.com'),
  ('50000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e5f-equipe@example.com'),
  ('50000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e5f-admin@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('50000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente A Teste', true, false),
  ('50000000-0000-0000-0000-0000000000c2', 'cliente', 'Cliente B Teste', true, false),
  ('50000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste', true, false),
  ('50000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor A Teste', true, false),
  ('50000000-0000-0000-0000-0000000000f2', 'fornecedor', 'Fornecedor B Teste', true, false),
  ('50000000-0000-0000-0000-0000000000f3', 'fornecedor', 'Fornecedor Pendente Teste', true, true),
  ('50000000-0000-0000-0000-0000000000f4', 'fornecedor', 'Fornecedor Inativo Teste', false, false),
  ('50000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste', true, false),
  ('50000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['50000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome)
values
  ('50000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste'),
  ('50000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste'),
  ('50000000-0000-0000-0000-000000000e03', 'Empreendimento C Teste');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('50000000-0000-0000-0000-000000000e01', '50000000-0000-0000-0000-0000000000c1'),
  ('50000000-0000-0000-0000-000000000e02', '50000000-0000-0000-0000-0000000000c2');

insert into public.fornecedores (id, razao_social, nome_fantasia, cnpj, observacao)
values
  ('50000000-0000-0000-0000-000000000f01', 'Fornecedor A Razão Teste', 'Fornecedor A Fantasia Teste', '11222333000181', 'Observação visível ao fornecedor A'),
  ('50000000-0000-0000-0000-000000000f02', 'Fornecedor B Razão Teste', null, null, null),
  ('50000000-0000-0000-0000-000000000f03', 'Fornecedor C Razão Teste', null, null, null);

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values
  ('50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-0000000000f1'),
  ('50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-0000000000f4'),
  ('50000000-0000-0000-0000-000000000f02', '50000000-0000-0000-0000-0000000000f2'),
  ('50000000-0000-0000-0000-000000000f03', '50000000-0000-0000-0000-0000000000f3');

-- Itens: a001 (A, fornecedor A), a002 (A, sem fornecedor), a003 (B, fornecedor B),
-- a004 (C, fornecedor C).
insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
values
  ('50000000-0000-0000-0000-00000000a001', '50000000-0000-0000-0000-000000000e01', '50000000-0000-0000-0000-000000000f01', 'Item A fornecedor A', 100000),
  ('50000000-0000-0000-0000-00000000a002', '50000000-0000-0000-0000-000000000e01', null, 'Item A sem fornecedor', 20000),
  ('50000000-0000-0000-0000-00000000a003', '50000000-0000-0000-0000-000000000e02', '50000000-0000-0000-0000-000000000f02', 'Item B fornecedor B', 30000),
  ('50000000-0000-0000-0000-00000000a004', '50000000-0000-0000-0000-000000000e01', '50000000-0000-0000-0000-000000000f03', 'Item A fornecedor C', 40000);

insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos, data_pagamento, valor_pago_centavos)
values
  ('50000000-0000-0000-0000-00000000b001', '50000000-0000-0000-0000-00000000a001', '2027-01-10', 50000, null, 0),
  ('50000000-0000-0000-0000-00000000b002', '50000000-0000-0000-0000-00000000a001', '2027-02-10', 50000, '2027-02-09', 50000),
  ('50000000-0000-0000-0000-00000000b003', '50000000-0000-0000-0000-00000000a002', '2027-01-10', 20000, null, 5000),
  ('50000000-0000-0000-0000-00000000b004', '50000000-0000-0000-0000-00000000a003', '2027-01-10', 30000, null, 0),
  ('50000000-0000-0000-0000-00000000b005', '50000000-0000-0000-0000-00000000a004', '2027-01-10', 40000, null, 0);

insert into public.fornecedor_contratos (id, fornecedor_id, empreendimento_id, titulo, storage_path, mime, tamanho)
values
  ('50000000-0000-0000-0000-00000000c001', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000e01', 'Contrato A', '50000000-0000-0000-0000-000000000f01/contratos/contrato.pdf', 'application/pdf', 100),
  ('50000000-0000-0000-0000-00000000c002', '50000000-0000-0000-0000-000000000f02', null, 'Contrato B', '50000000-0000-0000-0000-000000000f02/contratos/contrato.pdf', 'application/pdf', 100),
  ('50000000-0000-0000-0000-00000000c003', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000e03', 'Contrato A em C', '50000000-0000-0000-0000-000000000f01/contratos/em-c.pdf', 'application/pdf', 100);

insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
values
  ('50000000-0000-0000-0000-00000000d101', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-0000000000f1', 'certidao', 'Certidão A', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d101.pdf', 'application/pdf', 100),
  ('50000000-0000-0000-0000-00000000d102', '50000000-0000-0000-0000-000000000f02', '50000000-0000-0000-0000-0000000000f2', 'certidao', 'Certidão B', '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d102.pdf', 'application/pdf', 100),
  ('50000000-0000-0000-0000-00000000d103', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-0000000000f1', 'proposta', 'Proposta A', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d103.pdf', 'application/pdf', 100);

insert into public.downloads_log (arquivo_tipo, arquivo_id, profile_id)
values ('fornecedor_documento', '50000000-0000-0000-0000-00000000d101', '50000000-0000-0000-0000-0000000000f1');

insert into storage.objects (bucket_id, name)
values
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/contratos/contrato.pdf'),
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d101.pdf'),
  ('fornecedores', '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d102.pdf');

-- Objetos que enviar_documento_fornecedor exige no Storage, com o tamanho declarado no envio.
-- d228 existe com 5 bytes e é declarado com 6; d227 não tem objeto.
insert into storage.objects (bucket_id, name, metadata)
values
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d221.pdf', jsonb_build_object('size', 20971520)),
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d222.jpg', jsonb_build_object('size', 1)),
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d223.png', jsonb_build_object('size', 1)),
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d224.pdf', jsonb_build_object('size', 1)),
  ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d228.pdf', jsonb_build_object('size', 5)),
  ('fornecedores', '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d232.pdf', jsonb_build_object('size', 10));
insert into storage.objects (bucket_id, name, metadata)
select 'fornecedores',
  '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-0000000e' || lpad(g::text, 4, '0') || '.pdf',
  jsonb_build_object('size', 1)
from generate_series(4, 19) as g;

-- Estrutura: RLS ligado, anon sem privilégio, buckets privados, nenhuma política
-- de escrita direta no Storage, funções sem EXECUTE para anon.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'fornecedores', 'fornecedor_usuarios', 'fornecedor_contratos', 'fornecedor_documentos',
    'itens_financeiros', 'parcelas', 'downloads_log'
  ] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_tabela)::regclass) then
      raise exception 'FALHA: RLS desligado em %', v_tabela;
    end if;
    if has_table_privilege('anon', 'public.' || v_tabela, 'select,insert,update,delete') then
      raise exception 'FALHA: anon tem privilégio em %', v_tabela;
    end if;
  end loop;

  if (select count(*) from storage.buckets where id in ('obras', 'documentos', 'fornecedores') and not public) <> 3 then
    raise exception 'FALHA: os três buckets deveriam existir e ser privados';
  end if;

  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd <> 'SELECT'
      and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ '''(obras|documentos|fornecedores)'''
  ) then
    raise exception 'FALHA: ainda há política de escrita direta nos buckets privados';
  end if;

  if has_function_privilege('anon', 'public.enviar_documento_fornecedor(uuid, uuid, uuid, text, text, text, text, bigint)', 'execute') then
    raise exception 'FALHA: anon pode executar enviar_documento_fornecedor';
  end if;
  if not has_function_privilege('authenticated', 'public.enviar_documento_fornecedor(uuid, uuid, uuid, text, text, text, text, bigint)', 'execute') then
    raise exception 'FALHA: authenticated não pode executar enviar_documento_fornecedor';
  end if;
  if has_function_privilege('authenticated', 'public.validar_vinculos_acesso()', 'execute')
     or has_function_privilege('authenticated', 'public.validar_revisao_documento_fornecedor()', 'execute')
     or has_function_privilege('authenticated', 'public.validar_contrato_fornecedor()', 'execute') then
    raise exception 'FALHA: função de trigger executável por authenticated';
  end if;
end $$;

-- Restrições e triggers (como postgres).
do $$
declare
  v_id uuid;
begin
  -- CNPJ só com 14 dígitos (o dígito verificador é da aplicação); nulo é permitido.
  begin
    insert into public.fornecedores (razao_social, cnpj) values ('CNPJ com máscara', '11.222.333/0001-81');
    raise exception 'FALHA: CNPJ com máscara foi aceito';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.fornecedores (razao_social, cnpj) values ('CNPJ curto', '1122233300018');
    raise exception 'FALHA: CNPJ com 13 dígitos foi aceito';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.fornecedores (razao_social, cnpj) values ('CNPJ repetido', '11222333000181');
    raise exception 'FALHA: CNPJ duplicado foi aceito';
  exception when unique_violation then
    null;
  end;
  insert into public.fornecedores (razao_social, cnpj) values ('Sem CNPJ 1', null);
  insert into public.fornecedores (razao_social, cnpj) values ('Sem CNPJ 2', null);

  -- Vínculo exige perfil fornecedor e é imutável.
  begin
    insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
    values ('50000000-0000-0000-0000-000000000f02', '50000000-0000-0000-0000-0000000000c1');
    raise exception 'FALHA: cliente foi vinculado a fornecedor';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
    values ('50000000-0000-0000-0000-000000000f02', '50000000-0000-0000-0000-0000000000b1');
    raise exception 'FALHA: empreiteiro foi vinculado a fornecedor';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_usuarios set fornecedor_id = '50000000-0000-0000-0000-000000000f02'
    where profile_id = '50000000-0000-0000-0000-0000000000f1';
    raise exception 'FALHA: vínculo de fornecedor foi alterado';
  exception when check_violation then
    null;
  end;

  -- Contrato: título e empreendimento editáveis; arquivo imutável; caminho amarrado.
  update public.fornecedor_contratos set titulo = 'Contrato A editado'
  where id = '50000000-0000-0000-0000-00000000c001';
  update public.fornecedor_contratos set empreendimento_id = null
  where id = '50000000-0000-0000-0000-00000000c001';
  begin
    update public.fornecedor_contratos set storage_path = '50000000-0000-0000-0000-000000000f01/contratos/outro.pdf'
    where id = '50000000-0000-0000-0000-00000000c001';
    raise exception 'FALHA: caminho do contrato foi alterado';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_contratos set tamanho = 1
    where id = '50000000-0000-0000-0000-00000000c001';
    raise exception 'FALHA: tamanho do contrato foi alterado';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_contratos set fornecedor_id = '50000000-0000-0000-0000-000000000f02'
    where id = '50000000-0000-0000-0000-00000000c001';
    raise exception 'FALHA: contrato mudou de fornecedor';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('50000000-0000-0000-0000-000000000f01', 'Pasta errada', '50000000-0000-0000-0000-000000000f01/documentos/x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: contrato na pasta de documentos foi aceito';
  exception when check_violation then
    null;
  end;
  update public.fornecedor_contratos set empreendimento_id = '50000000-0000-0000-0000-000000000e01'
  where id = '50000000-0000-0000-0000-00000000c001';

  -- Contrato sem item financeiro no empreendimento é permitido (c003 em e03), e a
  -- remoção do empreendimento só zera a referência.
  delete from public.empreendimentos where id = '50000000-0000-0000-0000-000000000e03';
  select empreendimento_id into v_id from public.fornecedor_contratos
  where id = '50000000-0000-0000-0000-00000000c003';
  if not found or v_id is not null then
    raise exception 'FALHA: contrato deveria sobreviver ao empreendimento removido com empreendimento_id nulo';
  end if;

  -- Documento: conteúdo imutável, status só sai de pendente, recusa exige motivo.
  begin
    update public.fornecedor_documentos set titulo = 'Trocado' where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: título do documento foi alterado';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_documentos set storage_path = '50000000-0000-0000-0000-000000000f01/documentos/trocado.pdf'
    where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: caminho do documento foi alterado';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_documentos set fornecedor_id = '50000000-0000-0000-0000-000000000f02'
    where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: documento mudou de fornecedor';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_documentos set empreendimento_id = '50000000-0000-0000-0000-000000000e02'
    where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: documento foi transferido de empreendimento';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_documentos set status = 'recusado' where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: recusa sem motivo foi aceita';
  exception when check_violation then
    null;
  end;
  begin
    update public.fornecedor_documentos set status = 'recusado', motivo = 'ab' where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: recusa com motivo curto foi aceita';
  exception when check_violation then
    null;
  end;
  update public.fornecedor_documentos set status = 'recusado', motivo = 'Documento ilegível'
  where id = '50000000-0000-0000-0000-00000000d103';
  begin
    update public.fornecedor_documentos set status = 'aprovado', motivo = null where id = '50000000-0000-0000-0000-00000000d103';
    raise exception 'FALHA: documento recusado voltou a ser revisado';
  exception when sqlstate '55000' then
    null;
  end;
end $$;

-- Anon: nada.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['fornecedores', 'fornecedor_usuarios', 'fornecedor_contratos', 'fornecedor_documentos', 'itens_financeiros', 'parcelas'] loop
    begin
      execute format('select count(*) from public.%I', v_tabela);
      raise exception 'FALHA: anon leu %', v_tabela;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d201', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Anon',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d201.pdf', 'application/pdf', 10);
    raise exception 'FALHA: anon executou enviar_documento_fornecedor';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Clientes A e B: nenhum acesso a fornecedores, contratos, documentos ou arquivos.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 0
     or (select count(*) from public.fornecedor_usuarios) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0 then
    raise exception 'FALHA: cliente A viu dados de fornecedor';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: cliente A viu objeto de bucket privado';
  end if;
  if (select count(*) from public.itens_financeiros) <> 3 then
    raise exception 'FALHA: cliente A deveria ver os 3 itens do empreendimento A, viu %', (select count(*) from public.itens_financeiros);
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d202', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Cliente',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d202.pdf', 'application/pdf', 10);
    raise exception 'FALHA: cliente A enviou documento de fornecedor';
  exception when sqlstate '42501' then
    null;
  end;
  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('50000000-0000-0000-0000-000000000f01', 'Cliente', '50000000-0000-0000-0000-000000000f01/contratos/c.pdf', 'application/pdf', 1);
    raise exception 'FALHA: cliente A inseriu contrato';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 0
     or (select count(*) from public.fornecedor_usuarios) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0 then
    raise exception 'FALHA: cliente B viu dados de fornecedor';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: cliente B viu objeto de bucket privado';
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d203', '50000000-0000-0000-0000-000000000f02', null, 'outro', 'Cliente B',
      '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d203.pdf', 'application/pdf', 10);
    raise exception 'FALHA: cliente B enviou documento de fornecedor';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

-- Empreiteiro: sem acesso a nada de fornecedor nem a financeiro.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 0
     or (select count(*) from public.fornecedor_usuarios) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0
     or (select count(*) from public.itens_financeiros) <> 0
     or (select count(*) from public.parcelas) <> 0 then
    raise exception 'FALHA: empreiteiro viu dados de fornecedor ou financeiro';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: empreiteiro viu objeto de bucket privado';
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d204', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Empreiteiro',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d204.pdf', 'application/pdf', 10);
    raise exception 'FALHA: empreiteiro enviou documento de fornecedor';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

-- Fornecedor A: só o que é dele.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_caso record;
  v_estado text;
  v_id uuid;
  v_linhas bigint;
  v_i int;
begin
  if (select count(*) from public.fornecedores) <> 1
     or not exists (select 1 from public.fornecedores where id = '50000000-0000-0000-0000-000000000f01') then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio cadastro, viu %', (select count(*) from public.fornecedores);
  end if;
  if (select observacao from public.fornecedores where id = '50000000-0000-0000-0000-000000000f01') is distinct from 'Observação visível ao fornecedor A' then
    raise exception 'FALHA: fornecedor A não leu a própria observação';
  end if;
  if (select count(*) from public.fornecedor_usuarios) <> 1 then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio vínculo, viu %', (select count(*) from public.fornecedor_usuarios);
  end if;
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '50000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: fornecedor A deveria ver só o item a001, viu %', (select count(*) from public.itens_financeiros);
  end if;
  if (select count(*) from public.parcelas) <> 2
     or exists (select 1 from public.parcelas where item_id <> '50000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: fornecedor A deveria ver só as 2 parcelas do item a001, viu %', (select count(*) from public.parcelas);
  end if;
  if (select count(*) from public.parcelas_situacao) <> 2 then
    raise exception 'FALHA: fornecedor A deveria ver só 2 linhas de parcelas_situacao';
  end if;
  if (select count(*) from public.fornecedor_contratos) <> 2
     or exists (select 1 from public.fornecedor_contratos where fornecedor_id <> '50000000-0000-0000-0000-000000000f01') then
    raise exception 'FALHA: fornecedor A deveria ver só os 2 contratos dele, viu %', (select count(*) from public.fornecedor_contratos);
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 2
     or exists (select 1 from public.fornecedor_documentos where fornecedor_id <> '50000000-0000-0000-0000-000000000f01') then
    raise exception 'FALHA: fornecedor A deveria ver só os 2 documentos dele, viu %', (select count(*) from public.fornecedor_documentos);
  end if;

  -- Nada de cliente, cronograma, obra, perfil alheio, auditoria ou log.
  if (select count(*) from public.empreendimentos) <> 0
     or (select count(*) from public.empreendimento_clientes) <> 0
     or (select count(*) from public.obras) <> 0
     or (select count(*) from public.documentos) <> 0
     or (select count(*) from public.auditoria) <> 0
     or (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: fornecedor A viu dado de cliente, obra, auditoria ou log';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio perfil, viu %', (select count(*) from public.profiles);
  end if;
  if public.nome_empreendimento('50000000-0000-0000-0000-000000000e01') is distinct from 'Empreendimento A Teste' then
    raise exception 'FALHA: fornecedor A deveria ver o nome do empreendimento onde tem item';
  end if;
  if public.nome_empreendimento('50000000-0000-0000-0000-000000000e02') is not null then
    raise exception 'FALHA: fornecedor A viu o nome do empreendimento B';
  end if;
  if public.nome_fornecedor('50000000-0000-0000-0000-000000000f02') is not null then
    raise exception 'FALHA: fornecedor A viu o nome do fornecedor B';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: fornecedor A viu objeto de bucket privado';
  end if;

  -- Sem escrita direta.
  begin
    insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
    values ('50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-0000000000f1', 'outro', 'Direto',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d205.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor A inseriu documento direto';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('50000000-0000-0000-0000-000000000f01', 'Direto', '50000000-0000-0000-0000-000000000f01/contratos/direto.pdf', 'application/pdf', 1);
    raise exception 'FALHA: fornecedor A inseriu contrato direto';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.fornecedor_documentos set status = 'aprovado' where id = '50000000-0000-0000-0000-00000000d101';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: fornecedor A aprovou o próprio documento';
  end if;
  begin
    delete from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d101';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: fornecedor A apagou o próprio documento';
  end if;
  begin
    update public.fornecedores set observacao = 'Trocada' where id = '50000000-0000-0000-0000-000000000f01';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: fornecedor A alterou o próprio cadastro';
  end if;
  begin
    update public.fornecedor_contratos set titulo = 'Trocado' where id = '50000000-0000-0000-0000-00000000c001';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: fornecedor A alterou contrato';
  end if;
  begin
    update public.parcelas set valor_pago_centavos = 1 where id = '50000000-0000-0000-0000-00000000b001';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: fornecedor A alterou parcela';
  end if;

  -- RPC: entradas inválidas (id, fornecedor, empreendimento, tipo, título, caminho, mime, tamanho, esperado).
  for v_caso in
    select * from (values
      ('outro fornecedor', '50000000-0000-0000-0000-00000000d211'::uuid, '50000000-0000-0000-0000-000000000f02'::uuid, null::uuid, 'certidao', 'Título', '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d211.pdf', 'application/pdf', 100::bigint, '42501'),
      ('empreendimento sem item (B)', '50000000-0000-0000-0000-00000000d212', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000e02', 'certidao', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d212.pdf', 'application/pdf', 100, '42501'),
      ('empreendimento inexistente', '50000000-0000-0000-0000-00000000d213', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000999', 'certidao', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d213.pdf', 'application/pdf', 100, '42501'),
      ('tipo fora da lista', '50000000-0000-0000-0000-00000000d214', '50000000-0000-0000-0000-000000000f01', null, 'contrato', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d214.pdf', 'application/pdf', 100, '23514'),
      ('tipo nulo', '50000000-0000-0000-0000-00000000d215', '50000000-0000-0000-0000-000000000f01', null, null, 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d215.pdf', 'application/pdf', 100, '23514'),
      ('título curto', '50000000-0000-0000-0000-00000000d216', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'A', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d216.pdf', 'application/pdf', 100, '23514'),
      ('título longo', '50000000-0000-0000-0000-00000000d217', '50000000-0000-0000-0000-000000000f01', null, 'outro', repeat('x', 161), '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d217.pdf', 'application/pdf', 100, '23514'),
      ('tamanho zero', '50000000-0000-0000-0000-00000000d218', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d218.pdf', 'application/pdf', 0, '23514'),
      ('tamanho acima de 20 MiB', '50000000-0000-0000-0000-00000000d219', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d219.pdf', 'application/pdf', 20971521, '23514'),
      ('mime não permitido', '50000000-0000-0000-0000-00000000d21a', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d21a.zip', 'application/zip', 100, '23514'),
      ('extensão diverge do mime', '50000000-0000-0000-0000-00000000d21b', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d21b.png', 'application/pdf', 100, '23514'),
      ('pasta de contratos', '50000000-0000-0000-0000-00000000d21c', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/contratos/50000000-0000-0000-0000-00000000d21c.pdf', 'application/pdf', 100, '23514'),
      ('pasta de outro fornecedor', '50000000-0000-0000-0000-00000000d21d', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d21d.pdf', 'application/pdf', 100, '23514'),
      ('nome do arquivo no caminho', '50000000-0000-0000-0000-00000000d21e', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/nota.pdf', 'application/pdf', 100, '23514'),
      ('id de outro documento no caminho', '50000000-0000-0000-0000-00000000d21f', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d101.pdf', 'application/pdf', 100, '23514'),
      ('documento existente de outro fornecedor', '50000000-0000-0000-0000-00000000d102', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d102.pdf', 'application/pdf', 100, '42501'),
      ('objeto ausente no Storage', '50000000-0000-0000-0000-00000000d227', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d227.pdf', 'application/pdf', 100, '23514'),
      ('tamanho diferente do objeto no Storage', '50000000-0000-0000-0000-00000000d228', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Título', '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d228.pdf', 'application/pdf', 6, '23514')
    ) as t(rotulo, id, fornecedor, empreendimento, tipo, titulo, caminho, mime, tamanho, esperado)
  loop
    begin
      perform public.enviar_documento_fornecedor(
        v_caso.id, v_caso.fornecedor, v_caso.empreendimento, v_caso.tipo, v_caso.titulo,
        v_caso.caminho, v_caso.mime, v_caso.tamanho);
      v_estado := 'sem erro';
    exception when others then
      v_estado := sqlstate;
    end;
    if v_estado <> v_caso.esperado then
      raise exception 'FALHA: enviar_documento_fornecedor (%) esperava %, obteve %', v_caso.rotulo, v_caso.esperado, v_estado;
    end if;
  end loop;

  if exists (select 1 from public.fornecedor_documentos where id::text like '50000000-0000-0000-0000-00000000d21%' and id <> '50000000-0000-0000-0000-00000000d102') then
    raise exception 'FALHA: envio inválido deixou linha em fornecedor_documentos';
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 2 then
    raise exception 'FALHA: fornecedor A deveria continuar com 2 documentos após envios inválidos';
  end if;

  -- Envio válido, com e sem empreendimento, JPEG e PNG; repetição devolve o mesmo id.
  v_id := public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d221', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000e01',
    'nota_fiscal', '  Nota fiscal 123  ',
    '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d221.pdf', 'application/pdf', 20971520);
  if v_id <> '50000000-0000-0000-0000-00000000d221' then
    raise exception 'FALHA: RPC devolveu id diferente do informado';
  end if;
  if not exists (
    select 1 from public.fornecedor_documentos
    where id = v_id and status = 'pendente' and titulo = 'Nota fiscal 123'
      and enviado_por = '50000000-0000-0000-0000-0000000000f1'
      and empreendimento_id = '50000000-0000-0000-0000-000000000e01' and motivo is null
  ) then
    raise exception 'FALHA: documento enviado não nasceu pendente com o autor da sessão';
  end if;
  perform public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d222', '50000000-0000-0000-0000-000000000f01', null,
    'comprovante', 'Foto do comprovante',
    '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d222.jpg', 'image/jpeg', 1);
  perform public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d223', '50000000-0000-0000-0000-000000000f01', null,
    'proposta', 'Imagem da proposta',
    '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d223.png', 'image/png', 1);
  v_id := public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d221', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000e01',
    'nota_fiscal', 'Nota fiscal 123',
    '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d221.pdf', 'application/pdf', 20971520);
  if v_id <> '50000000-0000-0000-0000-00000000d221'
     or (select count(*) from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d221') <> 1 then
    raise exception 'FALHA: repetição do envio não foi idempotente';
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 5 then
    raise exception 'FALHA: fornecedor A deveria ter 5 documentos, tem %', (select count(*) from public.fornecedor_documentos);
  end if;

  -- Envio de documento que será excluído (replay recusado mais abaixo).
  perform public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d224', '50000000-0000-0000-0000-000000000f01', null,
    'outro', 'Será excluído',
    '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d224.pdf', 'application/pdf', 1);
end $$;

reset role;
delete from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d224';

set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_i int;
  v_id uuid;
begin
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d224', '50000000-0000-0000-0000-000000000f01', null,
      'outro', 'Será excluído',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d224.pdf', 'application/pdf', 1);
    raise exception 'FALHA: replay de documento excluído foi aceito';
  exception when check_violation then
    null;
  end;

  -- Limite de 20 pendentes por fornecedor: já há 4 pendentes (d103 está recusado).
  select count(*) into v_i from public.fornecedor_documentos where status = 'pendente';
  if v_i <> 4 then
    raise exception 'FALHA: esperava 4 pendentes antes de encher a fila, há %', v_i;
  end if;
  while v_i < 20 loop
    v_id := ('50000000-0000-0000-0000-0000000e' || lpad(v_i::text, 4, '0'))::uuid;
    perform public.enviar_documento_fornecedor(
      v_id, '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Pendente ' || v_i,
      '50000000-0000-0000-0000-000000000f01/documentos/' || v_id::text || '.pdf', 'application/pdf', 1);
    v_i := v_i + 1;
  end loop;
  begin
    v_id := gen_random_uuid();
    perform public.enviar_documento_fornecedor(
      v_id, '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Vigésimo primeiro',
      '50000000-0000-0000-0000-000000000f01/documentos/' || v_id::text || '.pdf', 'application/pdf', 1);
    raise exception 'FALHA: o 21º documento pendente foi aceito';
  exception when sqlstate '54000' then
    null;
  end;
  -- Repetir um envio já existente continua devolvendo o id, mesmo com a fila cheia.
  v_id := public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d221', '50000000-0000-0000-0000-000000000f01', '50000000-0000-0000-0000-000000000e01',
    'nota_fiscal', 'Nota fiscal 123',
    '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d221.pdf', 'application/pdf', 20971520);
  if v_id <> '50000000-0000-0000-0000-00000000d221' then
    raise exception 'FALHA: repetição com a fila cheia não devolveu o mesmo id';
  end if;
end $$;

-- A inserção pela RPC foi auditada com o ator real (o fornecedor, não a secret key).
reset role;
do $$
begin
  if not exists (
    select 1 from public.auditoria
    where tabela = 'fornecedor_documentos' and registro_id = '50000000-0000-0000-0000-00000000d221'
      and acao = 'INSERT' and ator_id = '50000000-0000-0000-0000-0000000000f1'
  ) then
    raise exception 'FALHA: envio do fornecedor não foi auditado com o autor da sessão';
  end if;
end $$;

-- Fornecedor B: só o que é dele.
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 1
     or not exists (select 1 from public.fornecedores where id = '50000000-0000-0000-0000-000000000f02') then
    raise exception 'FALHA: fornecedor B deveria ver só o próprio cadastro';
  end if;
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '50000000-0000-0000-0000-00000000a003') then
    raise exception 'FALHA: fornecedor B deveria ver só o item a003';
  end if;
  if (select count(*) from public.parcelas) <> 1 then
    raise exception 'FALHA: fornecedor B deveria ver só a parcela b004';
  end if;
  if (select count(*) from public.fornecedor_contratos) <> 1
     or not exists (select 1 from public.fornecedor_contratos where id = '50000000-0000-0000-0000-00000000c002') then
    raise exception 'FALHA: fornecedor B deveria ver só o contrato c002';
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 1
     or not exists (select 1 from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d102') then
    raise exception 'FALHA: fornecedor B deveria ver só o documento d102';
  end if;
  if public.nome_fornecedor('50000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: fornecedor B viu o nome do fornecedor A';
  end if;
  if public.nome_empreendimento('50000000-0000-0000-0000-000000000e01') is not null then
    raise exception 'FALHA: fornecedor B viu o nome do empreendimento A';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: fornecedor B viu objeto de bucket privado';
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d231', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Invasão',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d231.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor B enviou documento no fornecedor A';
  exception when sqlstate '42501' then
    null;
  end;
  -- Mesmo com o id de um documento existente do A, nada vaza nem é alterado.
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d101', '50000000-0000-0000-0000-000000000f02', null, 'outro', 'Sequestro',
      '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d101.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor B reaproveitou o id de documento do fornecedor A';
  exception when sqlstate '42501' then
    null;
  end;
  perform public.enviar_documento_fornecedor(
    '50000000-0000-0000-0000-00000000d232', '50000000-0000-0000-0000-000000000f02', null, 'outro', 'Documento B',
    '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d232.pdf', 'application/pdf', 10);
end $$;

-- Fornecedor com troca de senha pendente: sem papel operacional.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f3","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0
     or (select count(*) from public.itens_financeiros) <> 0
     or (select count(*) from public.parcelas) <> 0 then
    raise exception 'FALHA: fornecedor com troca de senha pendente viu dados';
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d241', '50000000-0000-0000-0000-000000000f03', null, 'outro', 'Pendente',
      '50000000-0000-0000-0000-000000000f03/documentos/50000000-0000-0000-0000-00000000d241.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor com troca de senha pendente enviou documento';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

-- Perfil inativo vinculado ao fornecedor A.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f4","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0
     or (select count(*) from public.itens_financeiros) <> 0
     or (select count(*) from public.parcelas) <> 0 then
    raise exception 'FALHA: perfil inativo viu dados de fornecedor';
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d242', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Inativo',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d242.pdf', 'application/pdf', 10);
    raise exception 'FALHA: perfil inativo enviou documento';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

-- Fornecedor A inativo: perde tudo; ao reativar, recupera.
reset role;
update public.fornecedores set ativo = false where id = '50000000-0000-0000-0000-000000000f01';

set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 0
     or (select count(*) from public.itens_financeiros) <> 0
     or (select count(*) from public.parcelas) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0 then
    raise exception 'FALHA: fornecedor inativo ainda vê dados';
  end if;
  if public.nome_empreendimento('50000000-0000-0000-0000-000000000e01') is not null then
    raise exception 'FALHA: fornecedor inativo ainda vê o nome do empreendimento';
  end if;
  begin
    perform public.enviar_documento_fornecedor(
      '50000000-0000-0000-0000-00000000d251', '50000000-0000-0000-0000-000000000f01', null, 'outro', 'Inativo',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d251.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor inativo enviou documento';
  exception when sqlstate '42501' then
    null;
  end;
end $$;

reset role;
update public.fornecedores set ativo = true where id = '50000000-0000-0000-0000-000000000f01';

set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 1
     or (select count(*) from public.itens_financeiros) <> 1
     or (select count(*) from public.parcelas) <> 2
     or (select count(*) from public.fornecedor_contratos) <> 2 then
    raise exception 'FALHA: fornecedor reativado não recuperou o acesso';
  end if;
end $$;

-- Equipe: lê tudo, edita contrato e revisa documento; não apaga documento nem
-- escreve no Storage.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_linhas bigint;
begin
  -- Só os dados deste teste (criados nesta transação: now() é o início dela); produção já tem fornecedores reais (09/11).
  if (select count(*) from public.fornecedores where criado_em >= now()) <> 5
     or (select count(*) from public.fornecedor_contratos where criado_em >= now()) <> 3 then
    raise exception 'FALHA: equipe deveria ver todos os fornecedores e contratos';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'fornecedores' and name in (
      '50000000-0000-0000-0000-000000000f01/contratos/contrato.pdf',
      '50000000-0000-0000-0000-000000000f01/documentos/50000000-0000-0000-0000-00000000d101.pdf',
      '50000000-0000-0000-0000-000000000f02/documentos/50000000-0000-0000-0000-00000000d102.pdf')) <> 3
     or (select count(*) from storage.objects where bucket_id = 'fornecedores') <> 25 then
    raise exception 'FALHA: equipe deveria ler os objetos do bucket fornecedores';
  end if;

  update public.fornecedor_contratos set titulo = 'Contrato A pela equipe', empreendimento_id = null
  where id = '50000000-0000-0000-0000-00000000c001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não editou título e empreendimento do contrato';
  end if;
  begin
    update public.fornecedor_contratos set storage_path = '50000000-0000-0000-0000-000000000f01/contratos/outro.pdf'
    where id = '50000000-0000-0000-0000-00000000c001';
    raise exception 'FALHA: equipe trocou o arquivo do contrato';
  exception when check_violation then
    null;
  end;
  insert into public.fornecedor_contratos (fornecedor_id, empreendimento_id, titulo, storage_path, mime, tamanho)
  values ('50000000-0000-0000-0000-000000000f02', '50000000-0000-0000-0000-000000000e02', 'Contrato B 2',
    '50000000-0000-0000-0000-000000000f02/contratos/50000000-0000-0000-0000-00000000c0f2.pdf', 'application/pdf', 10);

  begin
    insert into public.fornecedores (razao_social, cnpj) values ('Equipe CNPJ ruim', '123');
    raise exception 'FALHA: equipe cadastrou CNPJ fora do formato';
  exception when check_violation then
    null;
  end;

  -- Revisão: recusa exige motivo; aprovar zera o motivo; revisado não volta.
  begin
    update public.fornecedor_documentos set status = 'recusado' where id = '50000000-0000-0000-0000-00000000d101';
    raise exception 'FALHA: equipe recusou sem motivo';
  exception when check_violation then
    null;
  end;
  update public.fornecedor_documentos set status = 'recusado', motivo = 'Certidão vencida'
  where id = '50000000-0000-0000-0000-00000000d101';
  if not exists (
    select 1 from public.fornecedor_documentos
    where id = '50000000-0000-0000-0000-00000000d101' and status = 'recusado'
      and motivo = 'Certidão vencida' and revisado_por = '50000000-0000-0000-0000-0000000000e1' and revisado_em is not null
  ) then
    raise exception 'FALHA: recusa sem carimbo de revisão da equipe';
  end if;
  begin
    update public.fornecedor_documentos set status = 'aprovado' where id = '50000000-0000-0000-0000-00000000d101';
    raise exception 'FALHA: documento recusado foi aprovado depois';
  exception when sqlstate '55000' then
    null;
  end;
  update public.fornecedor_documentos set status = 'aprovado', motivo = 'ignorado'
  where id = '50000000-0000-0000-0000-00000000d232';
  if exists (select 1 from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d232' and motivo is not null)
     or not exists (select 1 from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d232' and status = 'aprovado') then
    raise exception 'FALHA: aprovação deveria limpar o motivo';
  end if;
  begin
    update public.fornecedor_documentos set tipo = 'outro' where id = '50000000-0000-0000-0000-00000000d221';
    raise exception 'FALHA: equipe alterou o tipo do documento';
  exception when check_violation then
    null;
  end;

  -- Só admin apaga documento.
  begin
    delete from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d221';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: equipe apagou documento de fornecedor';
  end if;
  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: equipe leu downloads_log';
  end if;

  -- Storage: sem escrita direta.
  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/direto.pdf');
    raise exception 'FALHA: equipe enviou objeto direto ao bucket fornecedores';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update storage.objects set name = name || '.bak' where bucket_id = 'fornecedores';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: equipe renomeou objeto do bucket fornecedores';
  end if;
  begin
    delete from storage.objects where bucket_id = 'fornecedores';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: equipe apagou objeto do bucket fornecedores';
  end if;
end $$;

-- Admin: apaga documento, lê o log, mas também não escreve no Storage.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_linhas bigint;
begin
  if (select count(*) from public.downloads_log where arquivo_tipo = 'fornecedor_documento') < 1 then
    raise exception 'FALHA: admin deveria ler downloads_log';
  end if;
  delete from public.fornecedor_documentos where id = '50000000-0000-0000-0000-00000000d221';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin não apagou documento de fornecedor';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '50000000-0000-0000-0000-000000000f01/documentos/admin.pdf');
    raise exception 'FALHA: admin enviou objeto direto ao bucket fornecedores';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from storage.objects where bucket_id = 'fornecedores';
    get diagnostics v_linhas = row_count;
  exception when insufficient_privilege then
    v_linhas := 0;
  end;
  if v_linhas <> 0 then
    raise exception 'FALHA: admin apagou objeto do bucket fornecedores direto';
  end if;
  begin
    update public.downloads_log set ip_hash = 'x';
    raise exception 'FALHA: admin atualizou downloads_log pelo RLS';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: todas as verificações de RLS da Etapa 5 (fornecedor) passaram' as resultado;

rollback;
