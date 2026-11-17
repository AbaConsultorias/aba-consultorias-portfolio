-- Testes da Etapa 7, frente B — tabelas do conector: RLS, privilégios por coluna e restrições.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo 20261103100000_etapa7_conector.sql, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa7_conector_rls.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa7_conector_rls.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
-- A parte de revisões e grupos está em etapa7_revisoes.sql.
--
-- Fixture (ids com prefixo 70000000-...):
--   empreendimento A (e01, codigo_pasta 111111) e B (e02); projeto A (a01) com categoria (ca1) em A;
--   projeto B (a02) com categoria (ca2) em B;
--   cliente de A (c1), empreiteiro (b1), fornecedor (f1), equipe (e1), admin (a1);
--   conector ativo (c01); documento d001 em A.

begin;

-- O banco aceita um só conector ativo, e o de produção já existe. Revogá-lo aqui vale só dentro
-- desta transação, que termina em ROLLBACK: o conector real não é afetado.
update public.conectores set revogado_em = now() where revogado_em is null;

insert into auth.users (id, aud, role, email)
values
  ('70000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e7-cliente@example.com'),
  ('70000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e7-empreiteiro@example.com'),
  ('70000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e7-fornecedor@example.com'),
  ('70000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e7-equipe@example.com'),
  ('70000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e7-admin@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('70000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E7', true, false),
  ('70000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste E7', true, false),
  ('70000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor Teste E7', true, false),
  ('70000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste E7', true, false),
  ('70000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste E7', true, false);

-- Etapa 8: a conta de equipe desta fixture recebe as 22 permissões (sem permissão, o RLS não deixa passar).
-- Pré-requisitos respeitados pela ordem do catálogo; gravado como postgres.
do $$
declare
  v_permissao text;
begin
  foreach v_permissao in array public.catalogo_permissoes() loop
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('70000000-0000-0000-0000-0000000000e1', v_permissao);
  end loop;
end $$;

insert into public.empreendimentos (id, nome, codigo_pasta)
values
  ('70000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste E7', '111111'),
  ('70000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste E7', null);

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('70000000-0000-0000-0000-000000000e01', '70000000-0000-0000-0000-0000000000c1');

insert into public.projetos (id, empreendimento_id, nome)
values
  ('70000000-0000-0000-0000-000000000a01', '70000000-0000-0000-0000-000000000e01', 'Projeto A Teste E7'),
  ('70000000-0000-0000-0000-000000000a02', '70000000-0000-0000-0000-000000000e02', 'Projeto B Teste E7');

insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values
  ('70000000-0000-0000-0000-000000000ca1', '70000000-0000-0000-0000-000000000a01', 'Categoria A', 1),
  ('70000000-0000-0000-0000-000000000ca2', '70000000-0000-0000-0000-000000000a02', 'Categoria B', 1);

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente)
values ('70000000-0000-0000-0000-00000000d001', '70000000-0000-0000-0000-000000000e01', 'Documento A',
        '70000000-0000-0000-0000-000000000e01/70000000-0000-0000-0000-00000000d001.pdf', 'application/pdf', 100, repeat('a', 64), true);

insert into public.conectores (id, nome, token_hash)
values ('70000000-0000-0000-0000-000000000c01', 'Conector teste', repeat('a', 64));

-- ---------------------------------------------------------------------------
-- Estrutura e restrições (como postgres, que ignora o RLS mas não os CHECK/UNIQUE/triggers).
-- ---------------------------------------------------------------------------

do $$
declare
  v_tabela text;
  v_texto text;
begin
  foreach v_tabela in array array['conectores', 'pasta_regras', 'configuracoes_conector', 'documento_origens', 'conector_envios'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_tabela)::regclass) then
      raise exception 'FALHA: RLS desligado em %', v_tabela;
    end if;
    if has_table_privilege('anon', 'public.' || v_tabela, 'select') then
      raise exception 'FALHA: anon tem SELECT em %', v_tabela;
    end if;
  end loop;

  -- codigo_pasta: só 6 dígitos, único, opcional.
  if (select liberacao_automatica from public.empreendimentos where id = '70000000-0000-0000-0000-000000000e01') then
    raise exception 'FALHA: liberacao_automatica deveria nascer desligada';
  end if;

  foreach v_texto in array array['12345', '1234567', 'abcdef', '12345a', '', ' 123456', '123456 ', E'123456\n', '١٢٣٤٥٦'] loop
    begin
      update public.empreendimentos set codigo_pasta = v_texto where id = '70000000-0000-0000-0000-000000000e02';
      raise exception 'FALHA: codigo_pasta inválido aceito: [%]', v_texto;
    exception when check_violation then
      null;
    end;
  end loop;

  begin
    update public.empreendimentos set codigo_pasta = '111111' where id = '70000000-0000-0000-0000-000000000e02';
    raise exception 'FALHA: codigo_pasta repetido aceito';
  exception when unique_violation then
    null;
  end;

  update public.empreendimentos set codigo_pasta = '000123' where id = '70000000-0000-0000-0000-000000000e02';
  update public.empreendimentos set codigo_pasta = null where id = '70000000-0000-0000-0000-000000000e02';
  insert into public.empreendimentos (nome) values ('Outro sem código E7');
  insert into public.empreendimentos (nome) values ('Outro sem código E7 (2)');

  -- configuracoes_conector: uma linha, ligada por padrão, e não entra outra.
  if (select count(*) from public.configuracoes_conector) <> 1
     or not (select liberacao_automatica_geral from public.configuracoes_conector) then
    raise exception 'FALHA: configuracoes_conector deveria ter uma linha com a liberação geral ligada';
  end if;
  begin
    insert into public.configuracoes_conector (liberacao_automatica_geral) values (false);
    raise exception 'FALHA: segunda linha em configuracoes_conector aceita';
  exception when unique_violation then
    null;
  end;
  begin
    insert into public.configuracoes_conector (unica) values (false);
    raise exception 'FALHA: unica = false aceito';
  exception when check_violation then
    null;
  end;

  -- pasta_regras: exatamente um destino coerente.
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id)
  values ('70000000-0000-0000-0000-000000000e01', '03 - PRODUTOS/LAN/APROVADO', '70000000-0000-0000-0000-000000000a01');
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, categoria_id, liberar_automatico)
  values ('70000000-0000-0000-0000-000000000e01', '03 - PRODUTOS/SAA', '70000000-0000-0000-0000-000000000a01', '70000000-0000-0000-0000-000000000ca1', true);
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo)
  values ('70000000-0000-0000-0000-000000000e01', '01 - FINANCEIRO\01 - PROPOSTA-CONTRATO', 'contratos');
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo, ativa)
  values ('70000000-0000-0000-0000-000000000e01', 'ORÇAMENTOS DE 3º', 'orcamentos', false);

  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo)
    values ('70000000-0000-0000-0000-000000000e01', 'sem destino');
    raise exception 'FALHA: regra sem destino aceita';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, grupo)
    values ('70000000-0000-0000-0000-000000000e01', 'projeto e grupo', '70000000-0000-0000-0000-000000000a01', 'contratos');
    raise exception 'FALHA: regra com projeto e grupo aceita';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, categoria_id, grupo)
    values ('70000000-0000-0000-0000-000000000e01', 'categoria e grupo', '70000000-0000-0000-0000-000000000ca1', 'contratos');
    raise exception 'FALHA: regra com categoria sem projeto aceita';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo)
    values ('70000000-0000-0000-0000-000000000e01', 'grupo inválido', 'outro');
    raise exception 'FALHA: grupo inválido aceito em pasta_regras';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo)
    values ('70000000-0000-0000-0000-000000000e01', 'ORÇAMENTOS DE 3º', 'orcamentos');
    raise exception 'FALHA: (empreendimento, caminho_prefixo) repetido aceito';
  exception when unique_violation then
    null;
  end;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id)
    values ('70000000-0000-0000-0000-000000000e01', 'projeto de outro empreendimento', '70000000-0000-0000-0000-000000000a02');
    raise exception 'FALHA: regra apontando para projeto de outro empreendimento aceita';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, categoria_id)
    values ('70000000-0000-0000-0000-000000000e01', 'categoria de outro projeto', '70000000-0000-0000-0000-000000000a01', '70000000-0000-0000-0000-000000000ca2');
    raise exception 'FALHA: regra apontando para categoria de outro projeto aceita';
  exception when check_violation then
    null;
  end;
  begin
    update public.pasta_regras set empreendimento_id = '70000000-0000-0000-0000-000000000e02'
     where caminho_prefixo = 'ORÇAMENTOS DE 3º';
    raise exception 'FALHA: regra transferida de empreendimento';
  exception when check_violation then
    null;
  end;

  foreach v_texto in array array[
    '../fora', 'a/../b', 'a\..\b', '/absoluto', '\\servidor\share', 'C:\pasta', 'a//b', 'a/', './a', '',
    '01 - DADOS DO EMPREENDEDOR/CNH', 'x/comprovante de renda', '02/Notas Fiscais', 'PLANILHAS',
    '02/Notas  Fiscais', 'NOTAS-FISCAIS', 'dados_do_empreendedor', 'x/Comprovánte', 'Plani lha',
    'a' || chr(769)
  ] loop
    begin
      insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo)
      values ('70000000-0000-0000-0000-000000000e01', v_texto, 'contratos');
      raise exception 'FALHA: caminho_prefixo inválido ou bloqueado aceito: [%]', v_texto;
    exception when check_violation then
      null;
    end;
  end loop;

  -- Regras de projeto somem com o projeto; a categoria apagada só tira a categoria da regra.
  delete from public.projeto_categorias_documento where id = '70000000-0000-0000-0000-000000000ca1';
  if (select categoria_id from public.pasta_regras where caminho_prefixo = '03 - PRODUTOS/SAA') is not null then
    raise exception 'FALHA: categoria apagada deveria virar null na regra';
  end if;

  -- Apagar um projeto (com categoria) leva as regras dele junto, sem travar na validação das regras.
  insert into public.projetos (id, empreendimento_id, nome)
  values ('70000000-0000-0000-0000-000000000a03', '70000000-0000-0000-0000-000000000e01', 'Projeto descartável E7');
  insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
  values ('70000000-0000-0000-0000-000000000ca3', '70000000-0000-0000-0000-000000000a03', 'Categoria descartável', 1);
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, categoria_id)
  values ('70000000-0000-0000-0000-000000000e01', 'DESCARTAVEL', '70000000-0000-0000-0000-000000000a03', '70000000-0000-0000-0000-000000000ca3');
  delete from public.projetos where id = '70000000-0000-0000-0000-000000000a03';
  if exists (select 1 from public.pasta_regras where caminho_prefixo = 'DESCARTAVEL') then
    raise exception 'FALHA: regra de projeto apagado deveria sumir junto';
  end if;

  -- conectores: hash hexadecimal de 64, único, um só ativo, chave imutável, revogação definitiva.
  begin
    insert into public.conectores (nome, token_hash) values ('Segundo ativo', repeat('b', 64));
    raise exception 'FALHA: segundo conector ativo aceito';
  exception when unique_violation then
    null;
  end;
  update public.conectores set revogado_em = now() where id = '70000000-0000-0000-0000-000000000c01';
  begin
    insert into public.conectores (nome, token_hash) values ('Hash repetido', repeat('a', 64));
    raise exception 'FALHA: token_hash repetido aceito';
  exception when unique_violation then
    null;
  end;
  foreach v_texto in array array['xyz', repeat('A', 64), repeat('a', 63), repeat('g', 64)] loop
    begin
      insert into public.conectores (nome, token_hash) values ('Hash ruim', v_texto);
      raise exception 'FALHA: token_hash inválido aceito: [%]', v_texto;
    exception when check_violation then
      null;
    end;
  end loop;
  begin
    insert into public.conectores (nome, token_hash) values ('   ', repeat('b', 64));
    raise exception 'FALHA: nome em branco aceito';
  exception when check_violation then
    null;
  end;
  insert into public.conectores (id, nome, token_hash)
  values ('70000000-0000-0000-0000-000000000c02', 'Conector novo', repeat('b', 64));
  begin
    update public.conectores set revogado_em = null where id = '70000000-0000-0000-0000-000000000c01';
    raise exception 'FALHA: conector revogado foi reativado';
  exception when check_violation then
    null;
  end;
  begin
    update public.conectores set token_hash = repeat('c', 64) where id = '70000000-0000-0000-0000-000000000c02';
    raise exception 'FALHA: token_hash foi trocado';
  exception when check_violation then
    null;
  end;
  update public.conectores
     set ultimo_contato_em = now(), versao = '2.0.0', ultimo_ciclo = '{"arquivos": 3}', arvore = '{"pastas": []}'
   where id = '70000000-0000-0000-0000-000000000c02';

  -- documento_origens
  insert into public.documento_origens (documento_id, conector_id, caminho_relativo, tamanho, sha256, mtime)
  values ('70000000-0000-0000-0000-00000000d001', '70000000-0000-0000-0000-000000000c02',
          '03 - PRODUTOS/LAN/projeto.pdf', 100, repeat('a', 64), now());
  begin
    insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256)
    values ('70000000-0000-0000-0000-00000000d001', 'outro.pdf', 100, repeat('a', 64));
    raise exception 'FALHA: dois registros de origem para o mesmo documento aceitos';
  exception when unique_violation then
    null;
  end;

  -- conector_envios: estado válido; duplicado só barra o confirmado do mesmo empreendimento.
  insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado, documento_id)
  values ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'a.pdf', 100, repeat('d', 64), 'confirmado',
          '70000000-0000-0000-0000-00000000d001');
  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado)
    values ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'b.pdf', 100, repeat('d', 64), 'confirmado');
    raise exception 'FALHA: segundo envio confirmado com o mesmo sha256 no mesmo empreendimento aceito';
  exception when unique_violation then
    null;
  end;
  insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado)
  values
    ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e02', 'b.pdf', 100, repeat('d', 64), 'confirmado'),
    ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'c.pdf', 100, repeat('d', 64), 'autorizado'),
    ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'd.pdf', 100, repeat('d', 64), 'duplicado'),
    ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', '../x.pdf', 0, repeat('e', 64), 'recusado');
  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado)
    values ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'e.pdf', 100, repeat('f', 64), 'pendente');
    raise exception 'FALHA: estado inválido aceito em conector_envios';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256)
    values ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'e.pdf', 100, 'xyz');
    raise exception 'FALHA: sha256 inválido aceito em conector_envios';
  exception when check_violation then
    null;
  end;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'conector_envios_conector_em_idx') then
    raise exception 'FALHA: falta o índice dos limites diários (conector_id, em)';
  end if;

  -- Apagar o documento leva a origem junto.
  insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho)
  values ('70000000-0000-0000-0000-00000000d002', '70000000-0000-0000-0000-000000000e01', 'Documento A2',
          '70000000-0000-0000-0000-000000000e01/70000000-0000-0000-0000-00000000d002.pdf', 'application/pdf', 100);
  insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256)
  values ('70000000-0000-0000-0000-00000000d002', 'apagar.pdf', 100, repeat('9', 64));
  delete from public.documentos where id = '70000000-0000-0000-0000-00000000d002';
  if exists (select 1 from public.documento_origens where documento_id = '70000000-0000-0000-0000-00000000d002') then
    raise exception 'FALHA: origem do documento apagado ficou no banco';
  end if;
end $$;

-- Auditoria: a do conector nunca carrega a chave, a árvore nem o ciclo, e o contato de rotina não gera linha.
do $$
declare
  v_antes bigint;
begin
  if exists (
    select 1 from public.auditoria
    where tabela = 'conectores'
      and (coalesce(antes, '{}'::jsonb) ? 'token_hash' or coalesce(depois, '{}'::jsonb) ? 'token_hash'
        or coalesce(antes, '{}'::jsonb) ? 'arvore' or coalesce(depois, '{}'::jsonb) ? 'arvore'
        or coalesce(antes, '{}'::jsonb) ? 'ultimo_ciclo' or coalesce(depois, '{}'::jsonb) ? 'ultimo_ciclo')
  ) then
    raise exception 'FALHA: auditoria do conector guardou token_hash, árvore ou ciclo';
  end if;
  if (select count(*) from public.auditoria where tabela = 'conectores' and acao = 'INSERT' and em >= now()) <> 2 then
    raise exception 'FALHA: auditoria deveria ter 2 emissões de conector';
  end if;

  select count(*) into v_antes from public.auditoria where tabela = 'conectores';
  update public.conectores set ultimo_contato_em = now(), ultimo_ciclo = '{"arquivos": 4}'
   where id = '70000000-0000-0000-0000-000000000c02';
  if (select count(*) from public.auditoria where tabela = 'conectores') <> v_antes then
    raise exception 'FALHA: contato de rotina do conector gerou linha de auditoria';
  end if;

  if not exists (select 1 from public.auditoria where tabela = 'pasta_regras' and acao = 'INSERT')
     or not exists (select 1 from public.auditoria where tabela = 'documento_origens' and acao = 'INSERT') then
    raise exception 'FALHA: pasta_regras ou documento_origens sem auditoria';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Anônimo: nada.
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['conectores', 'pasta_regras', 'configuracoes_conector', 'documento_origens', 'conector_envios'] loop
    begin
      execute format('select 1 from public.%I', v_tabela);
      raise exception 'FALHA: anon conseguiu ler %', v_tabela;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cliente, empreiteiro e fornecedor: nada das tabelas do conector.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.pasta_regras) <> 0 then
    raise exception 'FALHA: cliente lê pasta_regras';
  end if;
  if (select count(*) from public.conectores) <> 0 then
    raise exception 'FALHA: cliente lê conectores';
  end if;
  if (select count(*) from public.documento_origens) <> 0 then
    raise exception 'FALHA: cliente lê documento_origens';
  end if;
  if (select count(*) from public.conector_envios) <> 0 then
    raise exception 'FALHA: cliente lê conector_envios';
  end if;
  if (select count(*) from public.configuracoes_conector) <> 0 then
    raise exception 'FALHA: cliente lê configuracoes_conector';
  end if;

  begin
    perform token_hash from public.conectores;
    raise exception 'FALHA: cliente conseguiu pedir token_hash';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo)
    values ('70000000-0000-0000-0000-000000000e01', 'cliente', 'contratos');
    raise exception 'FALHA: cliente criou regra de pasta';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.conectores (nome, token_hash) values ('Cliente', repeat('1', 64));
    raise exception 'FALHA: cliente emitiu conector';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256)
    values ('70000000-0000-0000-0000-00000000d001', 'x.pdf', 1, repeat('1', 64));
    raise exception 'FALHA: cliente gravou documento_origens';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256)
    values ('70000000-0000-0000-0000-000000000c02', '70000000-0000-0000-0000-000000000e01', 'x.pdf', 1, repeat('1', 64));
    raise exception 'FALHA: cliente gravou conector_envios';
  exception when insufficient_privilege then
    null;
  end;

  update public.configuracoes_conector set liberacao_automatica_geral = false;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente alterou configuracoes_conector';
  end if;
  update public.pasta_regras set ativa = false;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente alterou pasta_regras';
  end if;
  update public.conectores set revogado_em = now();
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente revogou conector';
  end if;
  delete from public.pasta_regras;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: cliente apagou regras de pasta';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.pasta_regras) <> 0 or (select count(*) from public.conectores) <> 0
     or (select count(*) from public.documento_origens) <> 0 or (select count(*) from public.conector_envios) <> 0
     or (select count(*) from public.configuracoes_conector) <> 0 then
    raise exception 'FALHA: empreiteiro lê tabelas do conector';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.pasta_regras) <> 0 or (select count(*) from public.conectores) <> 0
     or (select count(*) from public.documento_origens) <> 0 or (select count(*) from public.conector_envios) <> 0
     or (select count(*) from public.configuracoes_conector) <> 0 then
    raise exception 'FALHA: fornecedor lê tabelas do conector';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Equipe: lê conectores sem token_hash, gerencia regras, liga/desliga a liberação geral; não emite
-- conector e não escreve origens nem envios.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.conectores where id in ('70000000-0000-0000-0000-000000000c01', '70000000-0000-0000-0000-000000000c02')) <> 2 then
    raise exception 'FALHA: equipe deveria ler os 2 conectores (um revogado)';
  end if;
  if (select count(*) from public.conectores where revogado_em is null and versao = '2.0.0') <> 1 then
    raise exception 'FALHA: equipe não lê versão e revogação do conector ativo';
  end if;
  if not exists (select 1 from (select ultimo_ciclo, arvore, ultimo_contato_em from public.conectores where arvore is not null) c) then
    raise exception 'FALHA: equipe não lê ultimo_ciclo/arvore do conector';
  end if;

  begin
    perform token_hash from public.conectores;
    raise exception 'FALHA: equipe leu token_hash';
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute 'select * from public.conectores';
    raise exception 'FALHA: select * em conectores deveria falhar (token_hash protegido)';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.conectores where token_hash = repeat('b', 64);
    raise exception 'FALHA: equipe filtrou por token_hash';
  exception when insufficient_privilege then
    null;
  end;
  if has_column_privilege('authenticated', 'public.conectores', 'token_hash', 'select')
     or has_column_privilege('authenticated', 'public.conectores', 'token_hash', 'update')
     or has_column_privilege('authenticated', 'public.conectores', 'token_hash', 'references') then
    raise exception 'FALHA: authenticated tem privilégio sobre token_hash';
  end if;
  if not has_column_privilege('authenticated', 'public.conectores', 'arvore', 'select') then
    raise exception 'FALHA: authenticated deveria ler arvore';
  end if;

  begin
    insert into public.conectores (nome, token_hash) values ('Equipe', repeat('2', 64));
    raise exception 'FALHA: equipe emitiu conector';
  exception when insufficient_privilege then
    null;
  end;
  update public.conectores set revogado_em = now() where id = '70000000-0000-0000-0000-000000000c02';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 0 then
    raise exception 'FALHA: equipe revogou conector';
  end if;
  begin
    delete from public.conectores;
    raise exception 'FALHA: equipe apagou conector';
  exception when insufficient_privilege then
    null;
  end;

  -- regras
  -- Só as regras do empreendimento de teste: produção já tem regras reais (piloto real).
  if (select count(*) from public.pasta_regras where empreendimento_id = '70000000-0000-0000-0000-000000000e01') <> 4 then
    raise exception 'FALHA: equipe deveria ler as 4 regras, leu %',
      (select count(*) from public.pasta_regras where empreendimento_id = '70000000-0000-0000-0000-000000000e01');
  end if;
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo)
  values ('70000000-0000-0000-0000-000000000e01', 'REGRA DA EQUIPE', 'contratos');
  -- Etapa 8 (D5, R3): a equipe edita regra desligada, mas ligar a liberação automática é só do admin, e regra
  -- ligada (a do SAA, da fixture) a equipe não altera nem apaga.
  update public.pasta_regras set ativa = false where caminho_prefixo = 'REGRA DA EQUIPE';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não editou regra';
  end if;
  begin
    update public.pasta_regras set liberar_automatico = true where caminho_prefixo = 'REGRA DA EQUIPE';
    get diagnostics v_linhas = row_count;
  exception when others then
    v_linhas := 0;
  end;
  if v_linhas <> 0 or (select liberar_automatico from public.pasta_regras where caminho_prefixo = 'REGRA DA EQUIPE') then
    raise exception 'FALHA: equipe ligou a liberação automática de uma regra';
  end if;
  begin
    insert into public.pasta_regras (empreendimento_id, caminho_prefixo, grupo, liberar_automatico)
    values ('70000000-0000-0000-0000-000000000e01', 'REGRA LIGADA DA EQUIPE', 'contratos', true);
    raise exception 'FALHA: equipe criou regra com a liberação automática ligada';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm like 'FALHA:%' then
      raise;
    end if;
  end;
  begin
    update public.pasta_regras set ativa = false where caminho_prefixo = '03 - PRODUTOS/SAA';
    get diagnostics v_linhas = row_count;
  exception when others then
    v_linhas := 0;
  end;
  if v_linhas <> 0 or not (select ativa from public.pasta_regras where caminho_prefixo = '03 - PRODUTOS/SAA') then
    raise exception 'FALHA: equipe alterou regra com a liberação automática ligada';
  end if;
  begin
    delete from public.pasta_regras where caminho_prefixo = '03 - PRODUTOS/SAA';
    get diagnostics v_linhas = row_count;
  exception when others then
    v_linhas := 0;
  end;
  if v_linhas <> 0 or not exists (select 1 from public.pasta_regras where caminho_prefixo = '03 - PRODUTOS/SAA') then
    raise exception 'FALHA: equipe apagou regra com a liberação automática ligada';
  end if;
  delete from public.pasta_regras where caminho_prefixo = 'REGRA DA EQUIPE';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não apagou regra';
  end if;

  -- configuração: só liga/desliga a liberação geral.
  if (select count(*) from public.configuracoes_conector) <> 1 then
    raise exception 'FALHA: equipe não lê a configuração do conector';
  end if;
  -- Etapa 8 (D5): o interruptor geral é só do admin; a equipe não consegue desligá-lo (a asserção que era da
  -- equipe passou para o admin, mais abaixo).
  begin
    update public.configuracoes_conector set liberacao_automatica_geral = false;
    get diagnostics v_linhas = row_count;
  exception when others then
    v_linhas := 0;
  end;
  if v_linhas <> 0 or not (select liberacao_automatica_geral from public.configuracoes_conector) then
    raise exception 'FALHA: equipe desligou a liberação automática geral';
  end if;
  begin
    insert into public.configuracoes_conector (unica) values (true);
    raise exception 'FALHA: equipe inseriu em configuracoes_conector';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.configuracoes_conector;
    raise exception 'FALHA: equipe apagou configuracoes_conector';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.configuracoes_conector set unica = false;
    raise exception 'FALHA: equipe alterou a coluna unica';
  exception when insufficient_privilege then
    null;
  end;

  -- origens e envios: leitura.
  -- Só os dados de teste: produção já tem origens e envios reais (piloto real).
  if (select count(*) from public.documento_origens o join public.documentos d on d.id = o.documento_id
       where d.empreendimento_id in ('70000000-0000-0000-0000-000000000e01', '70000000-0000-0000-0000-000000000e02')) <> 1
     or (select count(*) from public.conector_envios
          where empreendimento_id in ('70000000-0000-0000-0000-000000000e01', '70000000-0000-0000-0000-000000000e02')) <> 5 then
    raise exception 'FALHA: equipe deveria ler 1 origem e 5 envios';
  end if;
  begin
    insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256)
    values ('70000000-0000-0000-0000-00000000d001', 'x.pdf', 1, repeat('1', 64));
    raise exception 'FALHA: equipe gravou documento_origens';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.conector_envios;
    raise exception 'FALHA: equipe apagou conector_envios';
  exception when insufficient_privilege then
    null;
  end;

  -- empreendimento (Etapa 8, D5): a equipe, mesmo com todas as permissões, não liga o interruptor.
  begin
    update public.empreendimentos set codigo_pasta = '222222', liberacao_automatica = true
     where id = '70000000-0000-0000-0000-000000000e02';
    raise exception 'FALHA: equipe ligou liberacao_automatica';
  exception when insufficient_privilege then
    null;
  end;
end $$;

set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare
  v_linhas integer;
begin
  update public.empreendimentos set codigo_pasta = '222222', liberacao_automatica = true
   where id = '70000000-0000-0000-0000-000000000e02';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin não definiu codigo_pasta/liberacao_automatica';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- Admin: emite e revoga; a chave continua inacessível.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  begin
    insert into public.conectores (nome, token_hash) values ('Terceiro', repeat('3', 64));
    raise exception 'FALHA: admin emitiu conector com outro ativo';
  exception when unique_violation then
    null;
  end;

  update public.conectores set revogado_em = now() where id = '70000000-0000-0000-0000-000000000c02';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin não revogou conector';
  end if;

  insert into public.conectores (nome, token_hash) values ('Terceiro', repeat('3', 64));
  if (select criado_por from public.conectores where nome = 'Terceiro') is distinct from '70000000-0000-0000-0000-0000000000a1'::uuid then
    raise exception 'FALHA: criado_por deveria ser o admin que emitiu';
  end if;

  begin
    update public.conectores set token_hash = repeat('4', 64) where nome = 'Terceiro';
    raise exception 'FALHA: admin trocou token_hash';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform token_hash from public.conectores;
    raise exception 'FALHA: admin leu token_hash';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.conectores set revogado_em = null where id = '70000000-0000-0000-0000-000000000c02';
    raise exception 'FALHA: admin reativou conector revogado';
  exception when check_violation then
    null;
  end;
end $$;

select 'OK: tabelas do conector da Etapa 7 passaram nos testes de RLS' as resultado;

rollback;
