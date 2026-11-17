-- Testes de RLS da Etapa 2, parte C (documentos e financeiro).
-- Como rodar: depois de aplicar TODAS as migrations (A, B e C), cole no SQL Editor
-- do Supabase ou use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa2_documentos_financeiro_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script
-- para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids com prefixo 20000000-...):
--   empreendimento A (e01) e B (e02); obra A (b01) e B (b02);
--   cliente A (c1), cliente B (c2), cliente A com troca de senha pendente (c3);
--   empreiteiro da obra A (b1) e da obra B (b2);
--   fornecedor A (f01, usuário f1) e fornecedor B (f02, usuário f2);
--   equipe (e1) e admin (a1).
--
-- Storage: nos buckets privados (documentos, fornecedores) só a equipe tem política.
-- Cliente, fornecedor e empreiteiro nunca leem nem enviam objeto por RLS: download
-- (URL assinada de 60 s) e upload são da rota de servidor, com a secret key. O
-- fornecedor também não insere em fornecedor_documentos por RLS (só a rota).

begin;

insert into auth.users (id, aud, role, email)
values
  ('20000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e2c-cliente-a@example.com'),
  ('20000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'e2c-cliente-b@example.com'),
  ('20000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'e2c-cliente-pendente@example.com'),
  ('20000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e2c-empreiteiro-a@example.com'),
  ('20000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'e2c-empreiteiro-b@example.com'),
  ('20000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e2c-fornecedor-a@example.com'),
  ('20000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'e2c-fornecedor-b@example.com'),
  ('20000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e2c-equipe@example.com'),
  ('20000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e2c-admin@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('20000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente A Teste', true, false),
  ('20000000-0000-0000-0000-0000000000c2', 'cliente', 'Cliente B Teste', true, false),
  ('20000000-0000-0000-0000-0000000000c3', 'cliente', 'Cliente Pendente Teste', true, true),
  ('20000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro A Teste', true, false),
  ('20000000-0000-0000-0000-0000000000b2', 'empreiteiro', 'Empreiteiro B Teste', true, false),
  ('20000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor A Teste', true, false),
  ('20000000-0000-0000-0000-0000000000f2', 'fornecedor', 'Fornecedor B Teste', true, false),
  ('20000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste', true, false),
  ('20000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['20000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome)
values
  ('20000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste'),
  ('20000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('20000000-0000-0000-0000-000000000e01', '20000000-0000-0000-0000-0000000000c1'),
  ('20000000-0000-0000-0000-000000000e02', '20000000-0000-0000-0000-0000000000c2'),
  ('20000000-0000-0000-0000-000000000e01', '20000000-0000-0000-0000-0000000000c3');

insert into public.obras (id, empreendimento_id, nome)
values
  ('20000000-0000-0000-0000-000000000b01', '20000000-0000-0000-0000-000000000e01', 'Obra A Teste'),
  ('20000000-0000-0000-0000-000000000b02', '20000000-0000-0000-0000-000000000e02', 'Obra B Teste');

insert into public.obra_empreiteiros (obra_id, profile_id)
values
  ('20000000-0000-0000-0000-000000000b01', '20000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-000000000b02', '20000000-0000-0000-0000-0000000000b2');

insert into public.fornecedores (id, razao_social, nome_fantasia)
values
  ('20000000-0000-0000-0000-000000000f01', 'Fornecedor A Razão Teste', 'Fornecedor A Fantasia Teste'),
  ('20000000-0000-0000-0000-000000000f02', 'Fornecedor B Razão Teste', null);

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values
  ('20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f1'),
  ('20000000-0000-0000-0000-000000000f02', '20000000-0000-0000-0000-0000000000f2');

insert into public.projetos (id, empreendimento_id, nome)
values
  ('20000000-0000-0000-0000-000000000a01', '20000000-0000-0000-0000-000000000e01', 'Projeto A Teste');

insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values
  ('20000000-0000-0000-0000-000000000ca1', '20000000-0000-0000-0000-000000000a01', 'Contratos', 1);

-- Documentos: d001 liberado (A), d002 não liberado (A), d003 liberado (B),
-- d004 zip interno (A, nunca liberável).
insert into public.documentos (id, empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho, liberado_cliente)
values
  ('20000000-0000-0000-0000-00000000d001', '20000000-0000-0000-0000-000000000e01', '20000000-0000-0000-0000-000000000a01', '20000000-0000-0000-0000-000000000ca1', 'Liberado A', '20000000-0000-0000-0000-000000000e01/liberado.pdf', 'application/pdf', 100, true),
  ('20000000-0000-0000-0000-00000000d002', '20000000-0000-0000-0000-000000000e01', null, null, 'Não liberado A', '20000000-0000-0000-0000-000000000e01/nao-liberado.pdf', 'application/pdf', 100, false),
  ('20000000-0000-0000-0000-00000000d003', '20000000-0000-0000-0000-000000000e02', null, null, 'Liberado B', '20000000-0000-0000-0000-000000000e02/liberado.pdf', 'application/pdf', 100, true),
  ('20000000-0000-0000-0000-00000000d004', '20000000-0000-0000-0000-000000000e01', null, null, 'Zip interno A', '20000000-0000-0000-0000-000000000e01/interno.zip', 'application/zip', 100, false);

-- Itens: a001 (A, fornecedor A), a002 (A, sem fornecedor), a003 (B, fornecedor B).
insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
values
  ('20000000-0000-0000-0000-00000000a001', '20000000-0000-0000-0000-000000000e01', '20000000-0000-0000-0000-000000000f01', 'Item A fornecedor A', 100000),
  ('20000000-0000-0000-0000-00000000a002', '20000000-0000-0000-0000-000000000e01', null, 'Item A sem fornecedor', 20000),
  ('20000000-0000-0000-0000-00000000a003', '20000000-0000-0000-0000-000000000e02', '20000000-0000-0000-0000-000000000f02', 'Item B fornecedor B', 30000);

-- Parcelas: b001 aberta e b002 paga (item a001), b003 (item a002), b004 (item a003).
insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos, data_pagamento, valor_pago_centavos)
values
  ('20000000-0000-0000-0000-00000000b001', '20000000-0000-0000-0000-00000000a001', '2027-01-10', 50000, null, 0),
  ('20000000-0000-0000-0000-00000000b002', '20000000-0000-0000-0000-00000000a001', '2027-02-10', 50000, '2027-02-09', 50000),
  ('20000000-0000-0000-0000-00000000b003', '20000000-0000-0000-0000-00000000a002', '2027-01-10', 20000, null, 5000),
  ('20000000-0000-0000-0000-00000000b004', '20000000-0000-0000-0000-00000000a003', '2027-01-10', 30000, null, 0);

insert into public.fornecedor_contratos (id, fornecedor_id, empreendimento_id, titulo, storage_path, mime, tamanho)
values
  ('20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-000000000e01', 'Contrato A', '20000000-0000-0000-0000-000000000f01/contratos/contrato.pdf', 'application/pdf', 100),
  ('20000000-0000-0000-0000-00000000c002', '20000000-0000-0000-0000-000000000f02', null, 'Contrato B', '20000000-0000-0000-0000-000000000f02/contratos/contrato.pdf', 'application/pdf', 100);

insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
values
  ('20000000-0000-0000-0000-00000000d101', '20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f1', 'certidao', 'Certidão A', '20000000-0000-0000-0000-000000000f01/documentos/existente.pdf', 'application/pdf', 100),
  ('20000000-0000-0000-0000-00000000d102', '20000000-0000-0000-0000-000000000f02', '20000000-0000-0000-0000-0000000000f2', 'certidao', 'Certidão B', '20000000-0000-0000-0000-000000000f02/documentos/existente.pdf', 'application/pdf', 100);

insert into public.downloads_log (arquivo_tipo, arquivo_id, profile_id)
values ('documento', '20000000-0000-0000-0000-00000000d001', '20000000-0000-0000-0000-0000000000c1');

insert into storage.objects (bucket_id, name)
values
  ('documentos', '20000000-0000-0000-0000-000000000e01/liberado.pdf'),
  ('documentos', '20000000-0000-0000-0000-000000000e01/nao-liberado.pdf'),
  ('documentos', '20000000-0000-0000-0000-000000000e02/liberado.pdf'),
  ('fornecedores', '20000000-0000-0000-0000-000000000f01/contratos/contrato.pdf'),
  ('fornecedores', '20000000-0000-0000-0000-000000000f01/documentos/existente.pdf'),
  ('fornecedores', '20000000-0000-0000-0000-000000000f02/documentos/existente.pdf'),
  ('fornecedores', 'pasta-que-nao-e-uuid/documentos/x.pdf');

-- Estrutura: RLS ligado, anon sem privilégio, view com security_invoker,
-- buckets privados, triggers de atualizado_em e de auditoria.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'documentos', 'fornecedor_contratos', 'fornecedor_documentos',
    'itens_financeiros', 'parcelas', 'downloads_log'
  ] loop
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
  if not coalesce(
    (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.parcelas_situacao'::regclass),
    false
  ) then
    raise exception 'FALHA: parcelas_situacao não é security_invoker';
  end if;

  if (select count(*) from storage.buckets where id in ('documentos', 'fornecedores') and not public) <> 2 then
    raise exception 'FALHA: buckets documentos e fornecedores deveriam existir e ser privados';
  end if;
end $$;

update public.documentos set titulo = 'Liberado A editado', atualizado_em = '2000-01-01'
where id = '20000000-0000-0000-0000-00000000d001';

do $$
begin
  if (select atualizado_em from public.documentos where id = '20000000-0000-0000-0000-00000000d001') < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em de documentos';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'documentos'
      and registro_id = '20000000-0000-0000-0000-00000000d001'
      and acao = 'UPDATE'
  ) then
    raise exception 'FALHA: update em documentos não gerou linha de auditoria';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'parcelas'
      and registro_id = '20000000-0000-0000-0000-00000000b001'
      and acao = 'INSERT'
  ) then
    raise exception 'FALHA: insert em parcelas não gerou linha de auditoria';
  end if;

  begin
    update public.documentos set liberado_cliente = true
    where id = '20000000-0000-0000-0000-00000000d004';
    raise exception 'FALHA: documento zip foi liberado para o cliente';
  exception when check_violation then
    null;
  end;

  -- Caminho amarrado ao dono da linha.
  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000e01', 'Caminho de outro', '20000000-0000-0000-0000-000000000e02/outro.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento com caminho de outro empreendimento foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000e01', 'Sem pasta', 'sem-pasta.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento sem a pasta do empreendimento no caminho foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000e01', 'Travessia', '20000000-0000-0000-0000-000000000e01/../20000000-0000-0000-0000-000000000e02/x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento com .. no caminho foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000e01', 'Barra dupla', '20000000-0000-0000-0000-000000000e01//x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento com // no caminho foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    update public.documentos set storage_path = '20000000-0000-0000-0000-000000000e02/trocado.pdf'
    where id = '20000000-0000-0000-0000-00000000d002';
    raise exception 'FALHA: caminho do documento foi trocado para o de outro empreendimento';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', 'Pasta errada', '20000000-0000-0000-0000-000000000f01/documentos/contrato.pdf', 'application/pdf', 1);
    raise exception 'FALHA: contrato na pasta de documentos foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', 'Fornecedor errado', '20000000-0000-0000-0000-000000000f02/contratos/contrato.pdf', 'application/pdf', 1);
    raise exception 'FALHA: contrato com a pasta de outro fornecedor foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', 'Travessia', '20000000-0000-0000-0000-000000000f01/contratos/../x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: contrato com .. no caminho foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f1', 'certidao', 'Pasta errada', '20000000-0000-0000-0000-000000000f01/contratos/x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento de fornecedor na pasta de contratos foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f1', 'certidao', 'Fornecedor errado', '20000000-0000-0000-0000-000000000f02/documentos/x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento de fornecedor com a pasta de outro fornecedor foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f1', 'certidao', 'Barra dupla', '20000000-0000-0000-0000-000000000f01/documentos//x.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento de fornecedor com // no caminho foi aceito';
  exception when check_violation then
    null;
  end;

  insert into public.loteamentos (id, nome, slug)
  values ('20000000-0000-0000-0000-00000000e0e1', 'Loteamento Correções Teste', 'loteamento-correcoes-teste');
  insert into public.midias (tipo, storage_path, loteamento_id)
  values ('foto', 'loteamentos/20000000-0000-0000-0000-00000000e0e1/normal.jpg', '20000000-0000-0000-0000-00000000e0e1');

  begin
    insert into public.midias (tipo, storage_path, loteamento_id)
    values ('foto', 'loteamentos/20000000-0000-0000-0000-00000000e0e1/../segredo.jpg', '20000000-0000-0000-0000-00000000e0e1');
    raise exception 'FALHA: mídia com .. no caminho foi aceita';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.midias (tipo, storage_path, loteamento_id)
    values ('foto', 'loteamentos/20000000-0000-0000-0000-00000000e0e1//segredo.jpg', '20000000-0000-0000-0000-00000000e0e1');
    raise exception 'FALHA: mídia com // no caminho foi aceita';
  exception when check_violation then
    null;
  end;
end $$;

-- Anônimo: nenhuma tabela, nenhuma view, nenhuma função.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform 1 from public.documentos;
    raise exception 'FALHA: anon conseguiu ler documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.fornecedor_contratos;
    raise exception 'FALHA: anon conseguiu ler fornecedor_contratos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.fornecedor_documentos;
    raise exception 'FALHA: anon conseguiu ler fornecedor_documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.itens_financeiros;
    raise exception 'FALHA: anon conseguiu ler itens_financeiros';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.parcelas;
    raise exception 'FALHA: anon conseguiu ler parcelas';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.parcelas_situacao;
    raise exception 'FALHA: anon conseguiu ler parcelas_situacao';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.downloads_log;
    raise exception 'FALHA: anon conseguiu ler downloads_log';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.nome_empreendimento('20000000-0000-0000-0000-000000000e01');
    raise exception 'FALHA: anon conseguiu chamar nome_empreendimento';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.nome_fornecedor('20000000-0000-0000-0000-000000000f01');
    raise exception 'FALHA: anon conseguiu chamar nome_fornecedor';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.nome_pessoa('20000000-0000-0000-0000-0000000000c1');
    raise exception 'FALHA: anon conseguiu chamar nome_pessoa';
  exception when insufficient_privilege then
    null;
  end;

  begin
    if (select count(*) from storage.objects where bucket_id in ('documentos', 'fornecedores')) <> 0 then
      raise exception 'FALHA: anon enxerga objetos dos buckets privados';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Cliente A: só documentos liberados do empreendimento A; itens, parcelas e
-- situação do empreendimento A; nome do fornecedor do seu item.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if (select count(*) from public.documentos) <> 1 then
    raise exception 'FALHA: cliente A deveria ver exatamente 1 documento, viu %', (select count(*) from public.documentos);
  end if;
  if not exists (select 1 from public.documentos where id = '20000000-0000-0000-0000-00000000d001') then
    raise exception 'FALHA: cliente A não vê o documento liberado do empreendimento A';
  end if;
  if exists (select 1 from public.documentos where id in (
    '20000000-0000-0000-0000-00000000d002',
    '20000000-0000-0000-0000-00000000d003',
    '20000000-0000-0000-0000-00000000d004'
  )) then
    raise exception 'FALHA: cliente A vê documento não liberado ou de outro empreendimento';
  end if;

  if (select count(*) from public.itens_financeiros) <> 2 then
    raise exception 'FALHA: cliente A deveria ver 2 itens financeiros, viu %', (select count(*) from public.itens_financeiros);
  end if;
  if exists (select 1 from public.itens_financeiros where id = '20000000-0000-0000-0000-00000000a003') then
    raise exception 'FALHA: cliente A vê item financeiro do empreendimento B';
  end if;
  if (select count(*) from public.parcelas) <> 3 then
    raise exception 'FALHA: cliente A deveria ver 3 parcelas, viu %', (select count(*) from public.parcelas);
  end if;
  if exists (select 1 from public.parcelas where id = '20000000-0000-0000-0000-00000000b004') then
    raise exception 'FALHA: cliente A vê parcela do empreendimento B';
  end if;

  if (select count(*) from public.parcelas_situacao) <> 3 then
    raise exception 'FALHA: cliente A deveria ver 3 linhas em parcelas_situacao, viu %', (select count(*) from public.parcelas_situacao);
  end if;
  if (select quitada from public.parcelas_situacao where id = '20000000-0000-0000-0000-00000000b001') then
    raise exception 'FALHA: parcela aberta aparece como quitada';
  end if;
  if not (select quitada from public.parcelas_situacao where id = '20000000-0000-0000-0000-00000000b002') then
    raise exception 'FALHA: parcela paga não aparece como quitada';
  end if;
  if (select saldo_centavos from public.parcelas_situacao where id = '20000000-0000-0000-0000-00000000b001') <> 50000 then
    raise exception 'FALHA: saldo da parcela aberta deveria ser 50000';
  end if;
  if (select saldo_centavos from public.parcelas_situacao where id = '20000000-0000-0000-0000-00000000b003') <> 15000 then
    raise exception 'FALHA: saldo da parcela parcialmente paga deveria ser 15000';
  end if;
  if (select saldo_centavos from public.parcelas_situacao where id = '20000000-0000-0000-0000-00000000b002') <> 0 then
    raise exception 'FALHA: saldo da parcela quitada deveria ser 0';
  end if;

  if (select count(*) from public.fornecedor_contratos) <> 0 then
    raise exception 'FALHA: cliente não deveria ver contratos de fornecedor';
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 0 then
    raise exception 'FALHA: cliente não deveria ver documentos de fornecedor';
  end if;
  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: cliente não deveria ver downloads_log';
  end if;

  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is distinct from 'Fornecedor A Fantasia Teste' then
    raise exception 'FALHA: cliente A deveria ver o nome fantasia do fornecedor do seu item';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f02') is not null then
    raise exception 'FALHA: cliente A não deveria ver o nome de fornecedor sem relação com ele';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is distinct from 'Empreendimento A Teste' then
    raise exception 'FALHA: cliente A deveria ver o nome do seu empreendimento';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e02') is not null then
    raise exception 'FALHA: cliente A não deveria ver o nome do empreendimento B';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000b1') is distinct from 'Empreiteiro A Teste' then
    raise exception 'FALHA: cliente A deveria ver o nome do empreiteiro da obra do seu empreendimento';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000b2') is not null then
    raise exception 'FALHA: cliente A não deveria ver o nome do empreiteiro de outro empreendimento';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000c1') is distinct from 'Cliente A Teste' then
    raise exception 'FALHA: cliente A deveria ver o próprio nome';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000c2') is not null then
    raise exception 'FALHA: cliente A não deveria ver o nome de outro cliente';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000f1') is not null then
    raise exception 'FALHA: cliente A não deveria ver o nome de fornecedor via nome_pessoa';
  end if;

  -- Escrita: nada.
  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000e01', 'Intruso', '20000000-0000-0000-0000-000000000e01/intruso.pdf', 'application/pdf', 1);
    raise exception 'FALHA: cliente conseguiu inserir em documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos)
    values ('20000000-0000-0000-0000-000000000e01', 'Intruso', 1);
    raise exception 'FALHA: cliente conseguiu inserir em itens_financeiros';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.parcelas (item_id, vencimento, valor_previsto_centavos)
    values ('20000000-0000-0000-0000-00000000a001', '2027-03-10', 1);
    raise exception 'FALHA: cliente conseguiu inserir em parcelas';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.downloads_log (arquivo_tipo, arquivo_id)
    values ('documento', '20000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: cliente conseguiu inserir em downloads_log';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.documentos set liberado_cliente = false
    where id = '20000000-0000-0000-0000-00000000d001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu dar update em documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.parcelas set valor_pago_centavos = 50000
    where id = '20000000-0000-0000-0000-00000000b001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu dar update em parcelas';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.itens_financeiros set valor_contratado_centavos = 1
    where id = '20000000-0000-0000-0000-00000000a001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu dar update em itens_financeiros';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.documentos where id = '20000000-0000-0000-0000-00000000d001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu apagar em documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.parcelas where id = '20000000-0000-0000-0000-00000000b001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu apagar em parcelas';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- Storage: nem o arquivo do documento liberado é legível por RLS (o cliente baixa
  -- pela rota de servidor, que confere a linha de documentos e assina a URL).
  if (select count(*) from storage.objects where bucket_id in ('documentos', 'fornecedores', 'obras')) <> 0 then
    raise exception 'FALHA: cliente A não deveria ver nenhum objeto dos buckets privados, viu %',
      (select count(*) from storage.objects where bucket_id in ('documentos', 'fornecedores', 'obras'));
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'documentos'
      and name = '20000000-0000-0000-0000-000000000e01/liberado.pdf'
  ) then
    raise exception 'FALHA: cliente A lê por RLS o objeto do documento liberado';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '20000000-0000-0000-0000-000000000e01/intruso.pdf');
    raise exception 'FALHA: cliente conseguiu enviar arquivo ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f01/documentos/intruso.pdf');
    raise exception 'FALHA: cliente conseguiu enviar arquivo ao bucket fornecedores';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('obras', 'atualizacoes/20000000-0000-0000-0000-000000000e01/20000000-0000-0000-0000-000000000a99/intruso.jpg');
    raise exception 'FALHA: cliente conseguiu enviar arquivo ao bucket obras';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update storage.objects set name = name || '.bak'
    where bucket_id = 'documentos'
      and name = '20000000-0000-0000-0000-000000000e01/liberado.pdf';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu atualizar objeto do bucket documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Cliente B: só o que é do empreendimento B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 1
     or not exists (select 1 from public.documentos where id = '20000000-0000-0000-0000-00000000d003') then
    raise exception 'FALHA: cliente B deveria ver só o documento liberado do empreendimento B';
  end if;
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '20000000-0000-0000-0000-00000000a003') then
    raise exception 'FALHA: cliente B deveria ver só o item financeiro do empreendimento B';
  end if;
  if (select count(*) from public.parcelas) <> 1 or (select count(*) from public.parcelas_situacao) <> 1 then
    raise exception 'FALHA: cliente B deveria ver só a parcela do empreendimento B';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: cliente B não deveria ver o nome do fornecedor A';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f02') is null then
    raise exception 'FALHA: cliente B deveria ver o nome do fornecedor do seu item';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is not null then
    raise exception 'FALHA: cliente B não deveria ver o nome do empreendimento A';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('documentos', 'fornecedores', 'obras')) <> 0 then
    raise exception 'FALHA: cliente B não deveria ver nenhum objeto dos buckets privados';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '20000000-0000-0000-0000-000000000e02/intruso.pdf');
    raise exception 'FALHA: cliente B conseguiu enviar arquivo ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Cliente A com troca de senha pendente: sem papel, não vê nada.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente vê documentos';
  end if;
  if (select count(*) from public.itens_financeiros) <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente vê itens financeiros';
  end if;
  if (select count(*) from public.parcelas) <> 0 or (select count(*) from public.parcelas_situacao) <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente vê parcelas';
  end if;
  if (select count(*) from public.fornecedor_contratos) <> 0 or (select count(*) from public.fornecedor_documentos) <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente vê dados de fornecedor';
  end if;
  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente vê downloads_log';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is not null
     or public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is not null
     or public.nome_pessoa('20000000-0000-0000-0000-0000000000c3') is not null
     or public.nome_pessoa('20000000-0000-0000-0000-0000000000b1') is not null then
    raise exception 'FALHA: conta com troca de senha pendente recebeu nomes';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente enxerga objetos dos buckets';
  end if;
end $$;

-- Empreiteiro da obra A: nenhuma tabela de documentos/financeiro; só nomes.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 0
     or (select count(*) from public.itens_financeiros) <> 0
     or (select count(*) from public.parcelas) <> 0
     or (select count(*) from public.parcelas_situacao) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0
     or (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: empreiteiro não deveria ver documentos nem financeiro';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is distinct from 'Empreendimento A Teste' then
    raise exception 'FALHA: empreiteiro da obra A deveria ver o nome do empreendimento A';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e02') is not null then
    raise exception 'FALHA: empreiteiro da obra A não deveria ver o nome do empreendimento B';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: empreiteiro não deveria ver nome de fornecedor';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000b2') is not null then
    raise exception 'FALHA: empreiteiro não deveria ver o nome de outro empreiteiro';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: empreiteiro enxerga objetos dos buckets de documentos';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'obras') <> 0 then
    raise exception 'FALHA: empreiteiro enxerga objetos do bucket obras';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '20000000-0000-0000-0000-000000000e01/intruso.pdf');
    raise exception 'FALHA: empreiteiro conseguiu enviar arquivo ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f01/documentos/intruso.pdf');
    raise exception 'FALHA: empreiteiro conseguiu enviar arquivo ao bucket fornecedores';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('obras', 'relatos/20000000-0000-0000-0000-000000000b01/20000000-0000-0000-0000-000000000099/intruso.jpg');
    raise exception 'FALHA: empreiteiro conseguiu enviar arquivo ao bucket obras';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Empreiteiro da obra B: não vê o empreendimento A.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

do $$
begin
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is not null then
    raise exception 'FALHA: empreiteiro da obra B não deveria ver o nome do empreendimento A';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e02') is null then
    raise exception 'FALHA: empreiteiro da obra B deveria ver o nome do empreendimento B';
  end if;
end $$;

-- Fornecedor A: só o que é dele; envia documento pendente para si; não aprova.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '20000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio item financeiro';
  end if;
  if (select count(*) from public.parcelas) <> 2 or (select count(*) from public.parcelas_situacao) <> 2 then
    raise exception 'FALHA: fornecedor A deveria ver só as 2 parcelas do próprio item';
  end if;
  if (select count(*) from public.fornecedor_contratos) <> 1
     or not exists (select 1 from public.fornecedor_contratos where id = '20000000-0000-0000-0000-00000000c001') then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio contrato';
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 1
     or not exists (select 1 from public.fornecedor_documentos where id = '20000000-0000-0000-0000-00000000d101') then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio documento';
  end if;
  if (select count(*) from public.documentos) <> 0 then
    raise exception 'FALHA: fornecedor não deveria ver documentos do empreendimento';
  end if;
  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: fornecedor não deveria ver downloads_log';
  end if;

  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is distinct from 'Fornecedor A Fantasia Teste' then
    raise exception 'FALHA: fornecedor A deveria ver o próprio nome';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f02') is not null then
    raise exception 'FALHA: fornecedor A não deveria ver o nome do fornecedor B';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is distinct from 'Empreendimento A Teste' then
    raise exception 'FALHA: fornecedor A deveria ver o nome do empreendimento do seu item';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e02') is not null then
    raise exception 'FALHA: fornecedor A não deveria ver o nome do empreendimento B';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000c1') is not null then
    raise exception 'FALHA: fornecedor A não deveria ver o nome de um cliente';
  end if;

  -- O fornecedor não insere em fornecedor_documentos por RLS, nem pendente, nem no
  -- próprio nome, nem com caminho certo: o insert é só da rota de servidor (secret key)
  -- e da equipe.
  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', 'nota_fiscal', 'Nota nova', '20000000-0000-0000-0000-000000000f01/documentos/nota.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor A conseguiu inserir em fornecedor_documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho, status)
    values ('20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f1', 'nota_fiscal', 'Nota explícita', '20000000-0000-0000-0000-000000000f01/documentos/nota2.pdf', 'application/pdf', 10, 'pendente');
    raise exception 'FALHA: fornecedor A conseguiu inserir documento pendente explícito';
  exception when insufficient_privilege then
    null;
  end;

  if (select count(*) from public.fornecedor_documentos) <> 1 then
    raise exception 'FALHA: fornecedor A deveria continuar vendo só o próprio documento existente';
  end if;

  -- Insert negado: para o fornecedor B.
  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f02', 'nota_fiscal', 'Em nome do B', '20000000-0000-0000-0000-000000000f02/documentos/forjado.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor A conseguiu enviar documento em nome do fornecedor B';
  exception when insufficient_privilege then
    null;
  end;

  -- Insert negado: guard dos campos de revisão e do autor.
  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho, status)
    values ('20000000-0000-0000-0000-000000000f01', 'nota_fiscal', 'Já aprovado', '20000000-0000-0000-0000-000000000f01/documentos/aprovado.pdf', 'application/pdf', 10, 'aprovado');
    raise exception 'FALHA: fornecedor conseguiu inserir documento já aprovado';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho, motivo)
    values ('20000000-0000-0000-0000-000000000f01', 'nota_fiscal', 'Com motivo', '20000000-0000-0000-0000-000000000f01/documentos/motivo.pdf', 'application/pdf', 10, 'motivo forjado');
    raise exception 'FALHA: fornecedor conseguiu inserir documento com motivo';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho, revisado_por)
    values ('20000000-0000-0000-0000-000000000f01', 'nota_fiscal', 'Com revisor', '20000000-0000-0000-0000-000000000f01/documentos/revisor.pdf', 'application/pdf', 10, '20000000-0000-0000-0000-0000000000e1');
    raise exception 'FALHA: fornecedor conseguiu inserir documento com revisado_por';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho, revisado_em)
    values ('20000000-0000-0000-0000-000000000f01', 'nota_fiscal', 'Com data', '20000000-0000-0000-0000-000000000f01/documentos/data.pdf', 'application/pdf', 10, now());
    raise exception 'FALHA: fornecedor conseguiu inserir documento com revisado_em';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', '20000000-0000-0000-0000-0000000000f2', 'nota_fiscal', 'Autor forjado', '20000000-0000-0000-0000-000000000f01/documentos/autor.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor conseguiu inserir documento em nome de outro autor';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', 'nota_fiscal', 'Caminho alheio', '20000000-0000-0000-0000-000000000f02/documentos/alheio.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor conseguiu apontar para a pasta de outro fornecedor';
  exception when insufficient_privilege or check_violation then
    null;
  end;

  -- Não aprova, não edita, não apaga.
  begin
    update public.fornecedor_documentos set status = 'aprovado'
    where id = '20000000-0000-0000-0000-00000000d101';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu aprovar o próprio documento';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.fornecedor_documentos set titulo = 'Editado'
    where id = '20000000-0000-0000-0000-00000000d101';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu dar update em fornecedor_documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.fornecedor_documentos
    where id = '20000000-0000-0000-0000-00000000d101';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu apagar em fornecedor_documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- Não escreve contratos, itens nem parcelas.
  begin
    insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f01', 'Contrato forjado', '20000000-0000-0000-0000-000000000f01/contratos/forjado.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor conseguiu inserir em fornecedor_contratos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.fornecedor_contratos set titulo = 'Editado'
    where id = '20000000-0000-0000-0000-00000000c001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu dar update em fornecedor_contratos';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.itens_financeiros (empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
    values ('20000000-0000-0000-0000-000000000e01', '20000000-0000-0000-0000-000000000f01', 'Intruso', 1);
    raise exception 'FALHA: fornecedor conseguiu inserir em itens_financeiros';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.parcelas (item_id, vencimento, valor_previsto_centavos)
    values ('20000000-0000-0000-0000-00000000a001', '2027-03-10', 1);
    raise exception 'FALHA: fornecedor conseguiu inserir em parcelas';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.parcelas set valor_pago_centavos = 50000, data_pagamento = current_date
    where id = '20000000-0000-0000-0000-00000000b001';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu dar update em parcelas';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.documentos;
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu apagar em documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- Storage: nenhum objeto legível por RLS, nem da própria pasta (o fornecedor baixa
  -- pela rota de servidor); nenhum envio, nem para a própria pasta de documentos.
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: fornecedor A não deveria ver nenhum objeto dos buckets privados, viu %',
      (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras'));
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'fornecedores'
      and name = '20000000-0000-0000-0000-000000000f01/contratos/contrato.pdf'
  ) or exists (
    select 1 from storage.objects
    where bucket_id = 'fornecedores'
      and name = '20000000-0000-0000-0000-000000000f01/documentos/existente.pdf'
  ) then
    raise exception 'FALHA: fornecedor A lê por RLS os objetos da própria pasta';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f01/documentos/nota.pdf');
    raise exception 'FALHA: fornecedor conseguiu enviar arquivo para a própria pasta de documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f01/contratos/forjado.pdf');
    raise exception 'FALHA: fornecedor conseguiu enviar arquivo para a pasta de contratos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f02/documentos/forjado.pdf');
    raise exception 'FALHA: fornecedor conseguiu enviar arquivo para a pasta de outro fornecedor';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f01/documentos/sub/forjado.pdf');
    raise exception 'FALHA: fornecedor conseguiu enviar arquivo em subpasta de documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '20000000-0000-0000-0000-000000000e01/forjado.pdf');
    raise exception 'FALHA: fornecedor conseguiu enviar arquivo ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update storage.objects set name = name || '.bak'
    where bucket_id = 'fornecedores'
      and name = '20000000-0000-0000-0000-000000000f01/documentos/existente.pdf';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: fornecedor conseguiu atualizar objeto do bucket fornecedores';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Fornecedor B: só o que é dele.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.itens_financeiros) <> 1
     or not exists (select 1 from public.itens_financeiros where id = '20000000-0000-0000-0000-00000000a003') then
    raise exception 'FALHA: fornecedor B deveria ver só o próprio item financeiro';
  end if;
  if (select count(*) from public.parcelas) <> 1 then
    raise exception 'FALHA: fornecedor B deveria ver só a própria parcela';
  end if;
  if (select count(*) from public.fornecedor_contratos) <> 1
     or not exists (select 1 from public.fornecedor_contratos where id = '20000000-0000-0000-0000-00000000c002') then
    raise exception 'FALHA: fornecedor B deveria ver só o próprio contrato';
  end if;
  if (select count(*) from public.fornecedor_documentos) <> 1
     or not exists (select 1 from public.fornecedor_documentos where id = '20000000-0000-0000-0000-00000000d102') then
    raise exception 'FALHA: fornecedor B deveria ver só o próprio documento (sem o enviado pelo fornecedor A)';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is not null then
    raise exception 'FALHA: fornecedor B não deveria ver o nome do fornecedor A';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is not null then
    raise exception 'FALHA: fornecedor B não deveria ver o nome do empreendimento A';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: fornecedor B não deveria ver nenhum objeto dos buckets privados, viu %',
      (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras'));
  end if;
  begin
    insert into public.fornecedor_documentos (fornecedor_id, tipo, titulo, storage_path, mime, tamanho)
    values ('20000000-0000-0000-0000-000000000f02', 'nota_fiscal', 'Nota B', '20000000-0000-0000-0000-000000000f02/documentos/nota.pdf', 'application/pdf', 10);
    raise exception 'FALHA: fornecedor B conseguiu inserir em fornecedor_documentos';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Fornecedor A inativo: continua com papel, mas perde acesso a tudo que dependia de
-- usuario_do_fornecedor(). Ao reativar, o acesso volta.
reset role;
update public.fornecedores set ativo = false where id = '20000000-0000-0000-0000-000000000f01';

set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is distinct from 'fornecedor' then
    raise exception 'FALHA: fornecedor A inativo ainda deveria ter o papel fornecedor';
  end if;
  if public.usuario_do_fornecedor('20000000-0000-0000-0000-000000000f01') then
    raise exception 'FALHA: usuario_do_fornecedor deveria ser falso para fornecedor inativo';
  end if;
  if (select count(*) from public.itens_financeiros) <> 0
     or (select count(*) from public.parcelas) <> 0
     or (select count(*) from public.parcelas_situacao) <> 0
     or (select count(*) from public.fornecedor_contratos) <> 0
     or (select count(*) from public.fornecedor_documentos) <> 0
     or (select count(*) from public.fornecedores) <> 0
     or (select count(*) from storage.objects where bucket_id in ('fornecedores', 'documentos', 'obras')) <> 0 then
    raise exception 'FALHA: fornecedor A inativo não deveria ver nada';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f01') is not null
     or public.nome_empreendimento('20000000-0000-0000-0000-000000000e01') is not null then
    raise exception 'FALHA: fornecedor A inativo não deveria receber nomes';
  end if;
end $$;

reset role;
update public.fornecedores set ativo = true where id = '20000000-0000-0000-0000-000000000f01';

set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if not public.usuario_do_fornecedor('20000000-0000-0000-0000-000000000f01')
     or (select count(*) from public.itens_financeiros) <> 1
     or (select count(*) from public.fornecedor_contratos) <> 1 then
    raise exception 'FALHA: fornecedor A reativado deveria voltar a ver os próprios dados';
  end if;
end $$;

-- Equipe: acesso completo, menos apagar fornecedor_documentos e ler downloads_log.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_linhas int;
  v_id uuid;
begin
  if (select count(*) from public.documentos where id::text like '20000000-%') <> 4 then
    raise exception 'FALHA: equipe deveria ver os 4 documentos de teste';
  end if;
  if (select count(*) from public.itens_financeiros where id::text like '20000000-%') <> 3
     or (select count(*) from public.parcelas where id::text like '20000000-%') <> 4
     or (select count(*) from public.parcelas_situacao where id::text like '20000000-%') <> 4 then
    raise exception 'FALHA: equipe deveria ver todos os itens e parcelas de teste';
  end if;
  if (select count(*) from public.fornecedor_contratos where id::text like '20000000-%') <> 2
     or (select count(*) from public.fornecedor_documentos where fornecedor_id::text like '20000000-%') <> 2 then
    raise exception 'FALHA: equipe deveria ver todos os contratos e documentos de fornecedor de teste';
  end if;
  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: equipe não deveria ver downloads_log';
  end if;
  if public.nome_fornecedor('20000000-0000-0000-0000-000000000f02') is distinct from 'Fornecedor B Razão Teste' then
    raise exception 'FALHA: equipe deveria ver a razão social quando não há nome fantasia';
  end if;
  if public.nome_empreendimento('20000000-0000-0000-0000-000000000e02') is distinct from 'Empreendimento B Teste' then
    raise exception 'FALHA: equipe deveria ver o nome de qualquer empreendimento';
  end if;
  if public.nome_pessoa('20000000-0000-0000-0000-0000000000c2') is distinct from 'Cliente B Teste' then
    raise exception 'FALHA: equipe deveria ver o nome de qualquer pessoa';
  end if;

  insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
  values ('20000000-0000-0000-0000-000000000e01', 'Criado pela equipe', '20000000-0000-0000-0000-000000000e01/equipe.pdf', 'application/pdf', 10)
  returning id into v_id;

  -- Carimbo de liberação: liberado_por/liberado_em forjados são trocados pelo usuário e por now().
  update public.documentos set liberado_cliente = true, liberado_por = '20000000-0000-0000-0000-0000000000a1', liberado_em = '2000-01-01'
  where id = v_id;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu liberar documento';
  end if;
  if not exists (
    select 1 from public.documentos
    where id = v_id
      and liberado_cliente
      and liberado_por = '20000000-0000-0000-0000-0000000000e1'
      and liberado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: o carimbo de liberação deveria registrar quem liberou e now(), não o que veio no update';
  end if;

  -- Sem mudar liberado_cliente, os campos de liberação não mudam nem por update explícito.
  update public.documentos
  set titulo = 'Criado pela equipe (editado)', liberado_por = '20000000-0000-0000-0000-0000000000a1', liberado_em = '2000-01-01'
  where id = v_id;
  if not exists (
    select 1 from public.documentos
    where id = v_id
      and liberado_por = '20000000-0000-0000-0000-0000000000e1'
      and liberado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: liberado_por/liberado_em não podem mudar sem mudar liberado_cliente';
  end if;

  -- Ao desfazer a liberação, os dois campos voltam a nulo, mesmo com valores forjados.
  update public.documentos
  set liberado_cliente = false, liberado_por = '20000000-0000-0000-0000-0000000000a1', liberado_em = now()
  where id = v_id;
  if not exists (
    select 1 from public.documentos
    where id = v_id and not liberado_cliente and liberado_por is null and liberado_em is null
  ) then
    raise exception 'FALHA: desfazer a liberação deveria zerar liberado_por e liberado_em';
  end if;

  delete from public.documentos where id = v_id;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu apagar documento';
  end if;

  insert into public.itens_financeiros (empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
  values ('20000000-0000-0000-0000-000000000e01', '20000000-0000-0000-0000-000000000f01', 'Criado pela equipe', 5000)
  returning id into v_id;

  insert into public.parcelas (item_id, vencimento, valor_previsto_centavos)
  values (v_id, '2027-05-10', 5000);

  update public.parcelas set valor_pago_centavos = 5000, data_pagamento = '2027-05-10'
  where item_id = v_id;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu atualizar parcela';
  end if;

  delete from public.itens_financeiros where id = v_id;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu apagar item financeiro';
  end if;
  if exists (select 1 from public.parcelas where item_id = v_id) then
    raise exception 'FALHA: parcelas do item apagado deveriam ter sido apagadas em cascata';
  end if;

  insert into public.fornecedor_contratos (fornecedor_id, titulo, storage_path, mime, tamanho)
  values ('20000000-0000-0000-0000-000000000f01', 'Contrato da equipe', '20000000-0000-0000-0000-000000000f01/contratos/equipe.pdf', 'application/pdf', 10);

  insert into public.fornecedor_documentos (fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho, status)
  values ('20000000-0000-0000-0000-000000000f02', '20000000-0000-0000-0000-0000000000e1', 'certidao', 'Anexado pela equipe', '20000000-0000-0000-0000-000000000f02/documentos/equipe.pdf', 'application/pdf', 10, 'aprovado');

  -- Carimbo de revisão: revisado_por/revisado_em forjados são trocados pelo usuário e por now().
  update public.fornecedor_documentos
  set status = 'recusado', motivo = 'Ilegível', revisado_por = '20000000-0000-0000-0000-0000000000a1', revisado_em = '2000-01-01'
  where id = '20000000-0000-0000-0000-00000000d101';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu revisar documento de fornecedor';
  end if;
  if not exists (
    select 1 from public.fornecedor_documentos
    where id = '20000000-0000-0000-0000-00000000d101'
      and status = 'recusado'
      and revisado_por = '20000000-0000-0000-0000-0000000000e1'
      and revisado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: o carimbo de revisão do documento de fornecedor deveria usar o usuário logado e now()';
  end if;

  -- Sem mudar o status, a revisão não muda nem por update explícito.
  update public.fornecedor_documentos
  set motivo = 'Ilegível (detalhe)', revisado_por = '20000000-0000-0000-0000-0000000000a1', revisado_em = '2000-01-01'
  where id = '20000000-0000-0000-0000-00000000d101';
  if not exists (
    select 1 from public.fornecedor_documentos
    where id = '20000000-0000-0000-0000-00000000d101'
      and revisado_por = '20000000-0000-0000-0000-0000000000e1'
      and revisado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: revisado_por/revisado_em do documento de fornecedor não podem mudar sem mudar o status';
  end if;

  begin
    delete from public.fornecedor_documentos
    where id = '20000000-0000-0000-0000-00000000d101';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: equipe conseguiu apagar fornecedor_documentos (só admin pode)';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.downloads_log (arquivo_tipo, arquivo_id)
    values ('documento', '20000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: equipe conseguiu inserir em downloads_log';
  exception when insufficient_privilege then
    null;
  end;

  -- Etapas 4 e 5: documentos e fornecedores só recebem uploads pelo servidor.
  if (select count(*) from storage.objects where bucket_id = 'documentos' and name like '20000000-%') <> 3 then
    raise exception 'FALHA: equipe deveria ver os 3 objetos de teste do bucket documentos';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'fornecedores' and name like '20000000-%') <> 3 then
    raise exception 'FALHA: equipe deveria ver os 3 objetos de teste do bucket fornecedores';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '20000000-0000-0000-0000-000000000e01/equipe.pdf');
    raise exception 'FALHA: equipe conseguiu enviar diretamente ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('fornecedores', '20000000-0000-0000-0000-000000000f01/contratos/equipe.pdf');
    raise exception 'FALHA: equipe conseguiu enviar diretamente ao bucket fornecedores';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update storage.objects set name = name || '.v2'
    where bucket_id = 'documentos' and name like '20000000-%';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: equipe conseguiu atualizar diretamente objeto do bucket documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Admin: lê downloads_log; apaga fornecedor_documentos; não escreve downloads_log por RLS.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if (select count(*) from public.downloads_log where arquivo_id = '20000000-0000-0000-0000-00000000d001') <> 1 then
    raise exception 'FALHA: admin deveria ver a linha de downloads_log';
  end if;

  delete from public.fornecedor_documentos
  where id = '20000000-0000-0000-0000-00000000d101';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin não conseguiu apagar fornecedor_documentos';
  end if;

  begin
    insert into public.downloads_log (arquivo_tipo, arquivo_id)
    values ('documento', '20000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: admin conseguiu inserir em downloads_log pelo RLS';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.downloads_log set ip_hash = 'x';
    raise exception 'FALHA: admin conseguiu atualizar downloads_log pelo RLS';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: todas as verificações de RLS da Etapa 2 (documentos e financeiro) passaram' as resultado;

rollback;
