-- Testes de RLS da Etapa 4, frente B (documentos, liberação, log de downloads e Storage do bucket documentos).
-- Como rodar: depois de aplicar TODAS as migrations, incluindo 20261030100000_etapa4_portal.sql (frente A,
-- que remove as políticas de envio/atualização/exclusão de Storage da equipe), use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa4_documentos_rls.sql
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids com prefixo 4b000000-...):
--   empreendimento A (e01) e B (e02); projeto A (a01) com categoria (ca1);
--   cliente A (c1), cliente B (c2), cliente A com troca de senha pendente (c3), cliente A inativo (c4);
--   empreiteiro (b1), fornecedor (f1), equipe (e1) e admin (a1);
--   documentos: d001 liberado A, d002 oculto A, d003 liberado B, d004 zip interno A (nunca liberável).
--
-- Storage: o cliente nunca lê nem grava objeto por RLS (baixa pela rota, com URL assinada de 60 s). A equipe
-- só lê; envio é por URL assinada do servidor e a exclusão passa pela rota.

begin;

insert into auth.users (id, aud, role, email)
values
  ('4b000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e4b-cliente-a@example.com'),
  ('4b000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'e4b-cliente-b@example.com'),
  ('4b000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'e4b-cliente-pendente@example.com'),
  ('4b000000-0000-0000-0000-0000000000c4', 'authenticated', 'authenticated', 'e4b-cliente-inativo@example.com'),
  ('4b000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e4b-empreiteiro@example.com'),
  ('4b000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e4b-fornecedor@example.com'),
  ('4b000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e4b-equipe@example.com'),
  ('4b000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e4b-admin@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('4b000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente A Teste', true, false),
  ('4b000000-0000-0000-0000-0000000000c2', 'cliente', 'Cliente B Teste', true, false),
  ('4b000000-0000-0000-0000-0000000000c3', 'cliente', 'Cliente Pendente Teste', true, true),
  ('4b000000-0000-0000-0000-0000000000c4', 'cliente', 'Cliente Inativo Teste', true, false),
  ('4b000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste', true, false),
  ('4b000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor Teste', true, false),
  ('4b000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste', true, false),
  ('4b000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['4b000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome)
values
  ('4b000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste'),
  ('4b000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('4b000000-0000-0000-0000-000000000e01', '4b000000-0000-0000-0000-0000000000c1'),
  ('4b000000-0000-0000-0000-000000000e02', '4b000000-0000-0000-0000-0000000000c2'),
  ('4b000000-0000-0000-0000-000000000e01', '4b000000-0000-0000-0000-0000000000c3'),
  ('4b000000-0000-0000-0000-000000000e01', '4b000000-0000-0000-0000-0000000000c4');

-- Inativado depois do vínculo, para a fixture não esbarrar em validações de vínculo.
update public.profiles set ativo = false where id = '4b000000-0000-0000-0000-0000000000c4';

insert into public.fornecedores (id, razao_social)
values ('4b000000-0000-0000-0000-000000000f01', 'Fornecedor Razão Teste');

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values ('4b000000-0000-0000-0000-000000000f01', '4b000000-0000-0000-0000-0000000000f1');

insert into public.projetos (id, empreendimento_id, nome)
values ('4b000000-0000-0000-0000-000000000a01', '4b000000-0000-0000-0000-000000000e01', 'Projeto A Teste');

insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values ('4b000000-0000-0000-0000-000000000ca1', '4b000000-0000-0000-0000-000000000a01', 'Contratos', 1);

insert into public.documentos (id, empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente)
values
  ('4b000000-0000-0000-0000-00000000d001', '4b000000-0000-0000-0000-000000000e01', '4b000000-0000-0000-0000-000000000a01', '4b000000-0000-0000-0000-000000000ca1', 'Liberado A', '4b000000-0000-0000-0000-000000000e01/4b000000-0000-0000-0000-00000000d001.pdf', 'application/pdf', 100, repeat('a', 64), true),
  ('4b000000-0000-0000-0000-00000000d002', '4b000000-0000-0000-0000-000000000e01', null, null, 'Oculto A', '4b000000-0000-0000-0000-000000000e01/4b000000-0000-0000-0000-00000000d002.pdf', 'application/pdf', 100, repeat('b', 64), false),
  ('4b000000-0000-0000-0000-00000000d003', '4b000000-0000-0000-0000-000000000e02', null, null, 'Liberado B', '4b000000-0000-0000-0000-000000000e02/4b000000-0000-0000-0000-00000000d003.pdf', 'application/pdf', 100, repeat('c', 64), true),
  ('4b000000-0000-0000-0000-00000000d004', '4b000000-0000-0000-0000-000000000e01', null, null, 'Zip interno A', '4b000000-0000-0000-0000-000000000e01/4b000000-0000-0000-0000-00000000d004.zip', 'application/zip', 100, null, false);

insert into public.downloads_log (arquivo_tipo, arquivo_id, profile_id, ip_hash)
values ('documento', '4b000000-0000-0000-0000-00000000d001', '4b000000-0000-0000-0000-0000000000c1', repeat('f', 64));

insert into storage.objects (bucket_id, name)
values
  ('documentos', '4b000000-0000-0000-0000-000000000e01/4b000000-0000-0000-0000-00000000d001.pdf'),
  ('documentos', '4b000000-0000-0000-0000-000000000e01/4b000000-0000-0000-0000-00000000d002.pdf'),
  ('documentos', '4b000000-0000-0000-0000-000000000e02/4b000000-0000-0000-0000-00000000d003.pdf');

-- Anônimo: nada de documentos, log ou Storage.
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
    perform 1 from public.downloads_log;
    raise exception 'FALHA: anon conseguiu ler downloads_log';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('4b000000-0000-0000-0000-000000000e01', 'Anon', '4b000000-0000-0000-0000-000000000e01/anon.pdf', 'application/pdf', 1);
    raise exception 'FALHA: anon conseguiu inserir em documentos';
  exception when insufficient_privilege then
    null;
  end;

  if (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: anon enxerga objetos do bucket documentos';
  end if;
end $$;

-- Cliente A: só o documento liberado do empreendimento A; nada de escrita, log ou Storage.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.documentos) <> 1
     or not exists (select 1 from public.documentos where id = '4b000000-0000-0000-0000-00000000d001') then
    raise exception 'FALHA: cliente A deveria ver somente o documento liberado A, viu %', (select count(*) from public.documentos);
  end if;
  if exists (select 1 from public.documentos where id in (
    '4b000000-0000-0000-0000-00000000d002', '4b000000-0000-0000-0000-00000000d003', '4b000000-0000-0000-0000-00000000d004'
  )) then
    raise exception 'FALHA: cliente A vê documento oculto, de outro empreendimento ou não-PDF';
  end if;

  update public.documentos set liberado_cliente = true where id = '4b000000-0000-0000-0000-00000000d002';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente A conseguiu liberar documento';
  end if;

  update public.documentos set titulo = 'Trocado' where id = '4b000000-0000-0000-0000-00000000d001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente A conseguiu editar documento';
  end if;

  delete from public.documentos where id = '4b000000-0000-0000-0000-00000000d001';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente A conseguiu apagar documento';
  end if;

  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('4b000000-0000-0000-0000-000000000e01', 'Cliente', '4b000000-0000-0000-0000-000000000e01/cliente.pdf', 'application/pdf', 1);
    raise exception 'FALHA: cliente A conseguiu inserir documento';
  exception when insufficient_privilege then
    null;
  end;

  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: cliente A lê downloads_log';
  end if;
  begin
    insert into public.downloads_log (arquivo_tipo, arquivo_id, profile_id)
    values ('documento', '4b000000-0000-0000-0000-00000000d001', '4b000000-0000-0000-0000-0000000000c1');
    raise exception 'FALHA: cliente A gravou em downloads_log';
  exception when insufficient_privilege then
    null;
  end;

  if (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: cliente A lê por RLS objetos do bucket documentos';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '4b000000-0000-0000-0000-000000000e01/intruso.pdf');
    raise exception 'FALHA: cliente A enviou objeto ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Cliente B: só o documento do empreendimento B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 1
     or not exists (select 1 from public.documentos where id = '4b000000-0000-0000-0000-00000000d003') then
    raise exception 'FALHA: cliente B deveria ver somente o documento liberado B, viu %', (select count(*) from public.documentos);
  end if;
  if (select count(*) from public.downloads_log) <> 0 or (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: cliente B vê log de downloads ou objetos do Storage';
  end if;
end $$;

-- Conta com troca de senha pendente e conta inativa: sem papel operacional, nada de documentos.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000c3","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 0 or (select count(*) from public.downloads_log) <> 0
     or (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente enxerga documentos, log ou objetos';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000c4","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 0 or (select count(*) from public.downloads_log) <> 0
     or (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: conta inativa enxerga documentos, log ou objetos';
  end if;
end $$;

-- Empreiteiro e fornecedor: sem acesso a documentos de clientes.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 0 or (select count(*) from public.downloads_log) <> 0
     or (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: empreiteiro enxerga documentos, log ou objetos';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.documentos) <> 0 or (select count(*) from public.downloads_log) <> 0
     or (select count(*) from storage.objects where bucket_id = 'documentos') <> 0 then
    raise exception 'FALHA: fornecedor enxerga documentos, log ou objetos';
  end if;
end $$;

-- Equipe: gerencia documentos e carimbos; lê Storage mas não envia, atualiza nem apaga objeto; não lê o log.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
  v_id uuid;
begin
  -- A equipe também enxerga dados reais do banco: conta só as fixtures deste teste.
  if (select count(*) from public.documentos where id::text like '4b000000-%') <> 4 then
    raise exception 'FALHA: equipe deveria ver os 4 documentos, viu %', (select count(*) from public.documentos where id::text like '4b000000-%');
  end if;

  -- Nasce oculto, sem carimbo, hash opcional (a rota sempre grava o SHA-256).
  insert into public.documentos (empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho, sha256)
  values ('4b000000-0000-0000-0000-000000000e01', '4b000000-0000-0000-0000-000000000a01', '4b000000-0000-0000-0000-000000000ca1',
          'Novo', '4b000000-0000-0000-0000-000000000e01/4b000000-0000-0000-0000-00000000d005.pdf', 'application/pdf', 10, repeat('d', 64))
  returning id into v_id;
  if exists (select 1 from public.documentos where id = v_id and (liberado_cliente or liberado_por is not null or liberado_em is not null)) then
    raise exception 'FALHA: documento novo deveria nascer oculto e sem carimbo';
  end if;

  -- Liberar: o carimbo vem de auth.uid() e now(), nunca do que a equipe mandou.
  update public.documentos set liberado_cliente = true, liberado_por = '4b000000-0000-0000-0000-0000000000a1'
  where id = v_id;
  if not exists (
    select 1 from public.documentos
    where id = v_id and liberado_cliente
      and liberado_por = '4b000000-0000-0000-0000-0000000000e1' and liberado_em is not null
  ) then
    raise exception 'FALHA: liberação não carimbou o ator da sessão e a data';
  end if;

  -- Editar título não mexe no carimbo.
  update public.documentos set titulo = 'Novo editado' where id = v_id;
  if not exists (select 1 from public.documentos where id = v_id and liberado_por = '4b000000-0000-0000-0000-0000000000e1' and liberado_em is not null) then
    raise exception 'FALHA: edição de título alterou o carimbo de liberação';
  end if;

  -- Ocultar limpa o carimbo.
  update public.documentos set liberado_cliente = false where id = v_id;
  if exists (select 1 from public.documentos where id = v_id and (liberado_por is not null or liberado_em is not null)) then
    raise exception 'FALHA: ocultar não limpou o carimbo';
  end if;

  begin
    update public.documentos set liberado_cliente = true where id = '4b000000-0000-0000-0000-00000000d004';
    raise exception 'FALHA: documento zip foi liberado';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.documentos (empreendimento_id, titulo, storage_path, mime, tamanho)
    values ('4b000000-0000-0000-0000-000000000e01', 'Caminho de outro', '4b000000-0000-0000-0000-000000000e02/outro.pdf', 'application/pdf', 1);
    raise exception 'FALHA: documento com caminho de outro empreendimento foi aceito';
  exception when check_violation then
    null;
  end;

  begin
    update public.documentos set storage_path = '4b000000-0000-0000-0000-000000000e02/trocado.pdf'
    where id = '4b000000-0000-0000-0000-00000000d002';
    raise exception 'FALHA: caminho do documento foi trocado para o de outro empreendimento';
  exception when check_violation then
    null;
  end;

  delete from public.documentos where id = v_id;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu apagar a linha do documento';
  end if;

  -- Log de downloads: equipe não lê nem grava.
  if (select count(*) from public.downloads_log) <> 0 then
    raise exception 'FALHA: equipe lê downloads_log';
  end if;
  begin
    insert into public.downloads_log (arquivo_tipo, arquivo_id)
    values ('documento', '4b000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: equipe gravou em downloads_log';
  exception when insufficient_privilege then
    null;
  end;

  -- Storage: leitura sim; envio direto, troca de bytes e exclusão não (rota assina e apaga).
  if (select count(*) from storage.objects where bucket_id = 'documentos' and name like '4b000000-%') <> 3 then
    raise exception 'FALHA: equipe deveria ler os 3 objetos do bucket documentos, leu %',
      (select count(*) from storage.objects where bucket_id = 'documentos' and name like '4b000000-%');
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '4b000000-0000-0000-0000-000000000e01/direto.pdf');
    raise exception 'FALHA: equipe enviou objeto direto ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update storage.objects set name = name || '.bak' where bucket_id = 'documentos';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: equipe atualizou objeto do bucket documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from storage.objects where bucket_id = 'documentos';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: equipe apagou objeto do bucket documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;
  if (select count(*) from storage.objects where bucket_id = 'documentos' and name like '4b000000-%') <> 3 then
    raise exception 'FALHA: objetos do bucket documentos mudaram por acesso direto da equipe';
  end if;
end $$;

-- Admin: lê o log (só leitura); mesmas restrições de Storage.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"4b000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.documentos where id::text like '4b000000-%') <> 4 then
    raise exception 'FALHA: admin deveria ver os 4 documentos';
  end if;
  if (select count(*) from public.downloads_log where arquivo_tipo = 'documento'
        and arquivo_id = '4b000000-0000-0000-0000-00000000d001') <> 1 then
    raise exception 'FALHA: admin deveria ler o log de downloads';
  end if;
  -- Auditoria (só admin lê): a liberação feita pela equipe carrega o ator da sessão.
  if not exists (
    select 1 from public.auditoria
    where tabela = 'documentos' and acao = 'UPDATE'
      and ator_id = '4b000000-0000-0000-0000-0000000000e1'
      and (depois ->> 'liberado_cliente')::boolean
  ) then
    raise exception 'FALHA: liberação de documento não gerou auditoria com o ator da equipe';
  end if;
  if public.nome_pessoa('4b000000-0000-0000-0000-0000000000c1') is distinct from 'Cliente A Teste' then
    raise exception 'FALHA: admin deveria resolver o nome de quem baixou';
  end if;

  begin
    insert into public.downloads_log (arquivo_tipo, arquivo_id)
    values ('documento', '4b000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: admin gravou em downloads_log pelo RLS';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.downloads_log set ip_hash = 'x';
    raise exception 'FALHA: admin atualizou downloads_log pelo RLS';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.downloads_log;
    raise exception 'FALHA: admin apagou downloads_log pelo RLS';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('documentos', '4b000000-0000-0000-0000-000000000e01/direto-admin.pdf');
    raise exception 'FALHA: admin enviou objeto direto ao bucket documentos';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from storage.objects where bucket_id = 'documentos';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: admin apagou objeto do bucket documentos';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: todas as verificações de RLS da Etapa 4 (documentos) passaram' as resultado;

rollback;
