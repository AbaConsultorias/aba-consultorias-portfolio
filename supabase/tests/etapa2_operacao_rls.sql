-- Testes de RLS da Etapa 2, parte B (operação).
-- Como rodar: cole no SQL Editor do Supabase ou use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa2_operacao_rls.sql
-- Rode com o usuário postgres, depois de TODAS as migrations da Etapa 2 (precisa
-- de public.loteamentos, da migration A). Tudo acontece dentro de uma transação
-- que termina em ROLLBACK, então nada fica no banco. Se alguma verificação
-- falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK".
-- Storage: nos buckets privados só a equipe tem política; cliente, empreiteiro e
-- fornecedor nunca leem nem enviam objeto (download e upload são da rota de
-- servidor, com a secret key). Fotos de relato só são inseridas pela equipe ou
-- pela rota de servidor.
-- Pressupõe que os modelos do seed (SAA, SES, ...) ainda têm as categorias
-- originais. Remoção direta em storage.objects não é testada: o Supabase bloqueia
-- delete por SQL nessa tabela (só pela API do Storage).

begin;

-- O admin renomeia os modelos do seed pela tela (em 09/11: "Sistema de Abastecimento de Água - SAA" etc.). As
-- verificações abaixo usam os nomes curtos do seed: dentro desta transação (que termina em ROLLBACK) eles voltam.
update public.modelos_etapas m
   set nome = case
     when m.nome ~ ' - SAA$' then 'SAA'
     when m.nome ~ ' - SES$' then 'SES'
     when m.nome ~ ' - PER$' then 'PER'
     when m.nome ~ ' - PEC$' then 'PEC'
     when m.nome = 'Termo de Acordo e Plano de Trabalho' then 'Termo de Acordo'
     else m.nome
   end
 where m.nome ~ ' - (SAA|SES|PER|PEC)$' or m.nome = 'Termo de Acordo e Plano de Trabalho';

-- Funções auxiliares do teste (somem no rollback). Rodam como quem chama
-- (security invoker), então o RLS do papel atual vale dentro delas.
create function public.t_tabelas()
returns text[]
language sql
immutable
as $$
  select array[
    'fornecedores', 'fornecedor_usuarios', 'empreendimentos', 'empreendimento_clientes',
    'modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento', 'projetos',
    'projeto_etapas', 'projeto_categorias_documento', 'atualizacoes', 'atualizacao_fotos',
    'obras', 'obra_empreiteiros', 'relatos_obra', 'relato_fotos'
  ]
$$;

-- Escrita negada: erro 42501 (sem privilégio ou política) ou 0 linhas afetadas.
create function public.t_exige_negado(p_sql text, p_msg text)
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

-- O comando precisa falhar exatamente com o SQLSTATE informado.
create function public.t_exige_erro(p_sql text, p_estado text, p_msg text)
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
  if v_estado <> p_estado then
    raise exception 'FALHA: % (erro % em vez de %)', p_msg, v_estado, p_estado;
  end if;
end;
$$;

-- O comando precisa funcionar e afetar exatamente p_esperado linhas.
create function public.t_exige_linhas(p_sql text, p_esperado bigint, p_msg text)
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

-- As tabelas informadas precisam aparecer vazias para quem chama.
create function public.t_exige_vazio(p_tabelas text[], p_quem text)
returns void
language plpgsql
as $$
declare
  v_tabela text;
  v_conta bigint;
begin
  foreach v_tabela in array p_tabelas loop
    execute format('select count(*) from public.%I', v_tabela) into v_conta;
    if v_conta <> 0 then
      raise exception 'FALHA: % não deveria ver linhas de %, viu %', p_quem, v_tabela, v_conta;
    end if;
  end loop;
end;
$$;

grant execute on function public.t_tabelas() to anon, authenticated;
grant execute on function public.t_exige_negado(text, text) to anon, authenticated;
grant execute on function public.t_exige_erro(text, text, text) to anon, authenticated;
grant execute on function public.t_exige_linhas(text, bigint, text) to anon, authenticated;
grant execute on function public.t_exige_vazio(text[], text) to anon, authenticated;

-- Fixture: contas fake, uma por papel. Cliente "pendente" é um cliente do
-- empreendimento A que ainda não trocou a senha.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000002c1', 'authenticated', 'authenticated', 'cliente-a-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002c2', 'authenticated', 'authenticated', 'cliente-b-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002e1', 'authenticated', 'authenticated', 'empreiteiro-1-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002e2', 'authenticated', 'authenticated', 'empreiteiro-2-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002f1', 'authenticated', 'authenticated', 'fornecedor-a-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002f2', 'authenticated', 'authenticated', 'fornecedor-b-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002b1', 'authenticated', 'authenticated', 'equipe-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002a1', 'authenticated', 'authenticated', 'admin-etapa2@example.com'),
  ('00000000-0000-0000-0000-0000000002d1', 'authenticated', 'authenticated', 'pendente-etapa2@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000002c1', 'cliente', 'Cliente A Teste', true, false),
  ('00000000-0000-0000-0000-0000000002c2', 'cliente', 'Cliente B Teste', true, false),
  ('00000000-0000-0000-0000-0000000002e1', 'empreiteiro', 'Empreiteiro 1 Teste', true, false),
  ('00000000-0000-0000-0000-0000000002e2', 'empreiteiro', 'Empreiteiro 2 Teste', true, false),
  ('00000000-0000-0000-0000-0000000002f1', 'fornecedor', 'Fornecedor A Teste', true, false),
  ('00000000-0000-0000-0000-0000000002f2', 'fornecedor', 'Fornecedor B Teste', true, false),
  ('00000000-0000-0000-0000-0000000002b1', 'equipe', 'Equipe Teste', true, false),
  ('00000000-0000-0000-0000-0000000002a1', 'admin', 'Admin Teste', true, false),
  ('00000000-0000-0000-0000-0000000002d1', 'cliente', 'Cliente Senha Pendente Teste', true, true);

-- Etapa 8: a conta de equipe desta fixture recebe as 22 permissões (sem permissão, o RLS não deixa passar).
-- Pré-requisitos respeitados pela ordem do catálogo; gravado como postgres.
do $$
declare
  v_permissao text;
begin
  foreach v_permissao in array public.catalogo_permissoes() loop
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('00000000-0000-0000-0000-0000000002b1', v_permissao);
  end loop;
end $$;

-- Fixture: dois empreendimentos (A ligado a um loteamento), cada um com projeto,
-- obras, relatos e atualizações. Obra A1 -> empreiteiro 1; obra B1 -> empreiteiro 2;
-- obra A2 (empreendimento A) sem empreiteiro.
insert into public.loteamentos (id, nome, slug)
values ('00000000-0000-0000-0000-00000000e001', 'Loteamento Etapa2 Teste', 'loteamento-etapa2-teste');

insert into public.empreendimentos (id, nome, cidade, loteamento_id)
values
  ('00000000-0000-0000-0000-00000000a001', 'Empreendimento A Teste', 'Cidade A', '00000000-0000-0000-0000-00000000e001'),
  ('00000000-0000-0000-0000-00000000a002', 'Empreendimento B Teste', 'Cidade B', null);

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000002c1'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000002c2'),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000002d1');

insert into public.fornecedores (id, razao_social, cnpj)
values
  ('00000000-0000-0000-0000-00000000f001', 'Fornecedor A Teste Ltda', '00000000000191'),
  ('00000000-0000-0000-0000-00000000f002', 'Fornecedor B Teste Ltda', '00000000000272');

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000002f1'),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000002f2');

insert into public.projetos (id, empreendimento_id, nome)
values
  ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-00000000a001', 'Projeto A Teste'),
  ('00000000-0000-0000-0000-000000005002', '00000000-0000-0000-0000-00000000a002', 'Projeto B Teste');

insert into public.projeto_etapas (id, projeto_id, nome, ordem)
values
  ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-000000005001', 'Etapa A1', 1),
  ('00000000-0000-0000-0000-00000000e0a2', '00000000-0000-0000-0000-000000005001', 'Etapa A2', 2),
  ('00000000-0000-0000-0000-00000000e0b1', '00000000-0000-0000-0000-000000005002', 'Etapa B1', 1);

update public.projetos set etapa_atual_id = '00000000-0000-0000-0000-00000000e0a1'
where id = '00000000-0000-0000-0000-000000005001';
update public.projetos set etapa_atual_id = '00000000-0000-0000-0000-00000000e0b1'
where id = '00000000-0000-0000-0000-000000005002';

insert into public.projeto_categorias_documento (projeto_id, nome, ordem)
values
  ('00000000-0000-0000-0000-000000005001', 'Contratos', 1),
  ('00000000-0000-0000-0000-000000005002', 'Contratos', 1);

insert into public.obras (id, empreendimento_id, nome)
values
  ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000a001', 'Obra A1 Teste'),
  ('00000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-00000000a001', 'Obra A2 Teste'),
  ('00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-00000000a002', 'Obra B1 Teste');

insert into public.obra_empreiteiros (obra_id, profile_id)
values
  ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1'),
  ('00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000002e2');

insert into public.relatos_obra (id, obra_id, autor_id, texto, status, motivo_devolucao, revisado_por, revisado_em)
values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1',
   'Relato A1 aprovado', 'aprovado', null, '00000000-0000-0000-0000-0000000002b1', now()),
  ('00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1',
   'Relato A1 pendente', 'pendente', null, null, null),
  ('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1',
   'Relato A1 devolvido', 'devolvido', 'Faltou foto', '00000000-0000-0000-0000-0000000002b1', now()),
  ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000002e2',
   'Relato B1 aprovado', 'aprovado', null, '00000000-0000-0000-0000-0000000002b1', now());

insert into public.relato_fotos (relato_id, storage_path, mime, tamanho)
values
  ('00000000-0000-0000-0000-00000000c0a1', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a1/etapa2-teste-f1.jpg', 'image/jpeg', 1000),
  ('00000000-0000-0000-0000-00000000c0a2', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-f1.jpg', 'image/jpeg', 1000),
  ('00000000-0000-0000-0000-00000000c0b1', 'relatos/00000000-0000-0000-0000-00000000b0b1/00000000-0000-0000-0000-00000000c0b1/etapa2-teste-f1.jpg', 'image/jpeg', 1000);

-- Relato antigo do empreiteiro 1 em obra à qual ele não está vinculado.
insert into public.relatos_obra (id, obra_id, autor_id, texto, status)
values
  ('00000000-0000-0000-0000-00000000c0a4', '00000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000002e1',
   'Relato antigo em obra sem vínculo', 'pendente');

insert into public.relato_fotos (relato_id, storage_path, mime, tamanho)
values
  ('00000000-0000-0000-0000-00000000c0a4', 'relatos/00000000-0000-0000-0000-00000000b0a2/00000000-0000-0000-0000-00000000c0a4/etapa2-teste-f2.jpg', 'image/jpeg', 1000);

insert into public.atualizacoes (id, empreendimento_id, titulo, publicado)
values
  ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000a001', 'Atualização A publicada', true),
  ('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-00000000a001', 'Atualização A rascunho', false),
  ('00000000-0000-0000-0000-00000000d0b1', '00000000-0000-0000-0000-00000000a002', 'Atualização B publicada', true);

insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho)
values
  ('00000000-0000-0000-0000-00000000d0a1', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-f1.jpg', 'image/jpeg', 1000),
  ('00000000-0000-0000-0000-00000000d0a2', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a2/etapa2-teste-f1.jpg', 'image/jpeg', 1000),
  ('00000000-0000-0000-0000-00000000d0b1', 'atualizacoes/00000000-0000-0000-0000-00000000a002/00000000-0000-0000-0000-00000000d0b1/etapa2-teste-f1.jpg', 'image/jpeg', 1000);

-- Os mesmos arquivos como objetos do bucket obras (seis -f1 e o -f2 do relato antigo).
insert into storage.objects (bucket_id, name)
values
  ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a1/etapa2-teste-f1.jpg'),
  ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-f1.jpg'),
  ('obras', 'relatos/00000000-0000-0000-0000-00000000b0b1/00000000-0000-0000-0000-00000000c0b1/etapa2-teste-f1.jpg'),
  ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-f1.jpg'),
  ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a2/etapa2-teste-f1.jpg'),
  ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a002/00000000-0000-0000-0000-00000000d0b1/etapa2-teste-f1.jpg'),
  ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a2/00000000-0000-0000-0000-00000000c0a4/etapa2-teste-f2.jpg');

-- Estrutura (como postgres): RLS ligado e anon sem privilégio em todas as
-- tabelas, bucket privado, seed, atualizado_em e auditoria.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array public.t_tabelas() loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || quote_ident(v_tabela))::regclass) then
      raise exception 'FALHA: RLS desligado em %', v_tabela;
    end if;
    if has_table_privilege('anon', 'public.' || quote_ident(v_tabela), 'select,insert,update,delete') then
      raise exception 'FALHA: anon tem privilégio em %', v_tabela;
    end if;
  end loop;

  if not exists (
    select 1 from storage.buckets
    where id = 'obras'
      and not public
      and file_size_limit = 15728640
      and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
      and cardinality(allowed_mime_types) = 5
  ) then
    raise exception 'FALHA: bucket obras deveria ser privado, de 15 MB e só com imagens';
  end if;

  -- Nos buckets privados só existe política de equipe; nenhuma depende de papel de cliente,
  -- empreiteiro ou fornecedor, nem de auth.uid().
  if exists (
    select 1
    from pg_policies p
    cross join lateral (select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as texto) t
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and t.texto ~ '''(obras|documentos|fornecedores)'''
      and (
        t.texto !~ 'e_staff|tem_permissao'
        or t.texto ~ '(cliente_do_empreendimento|empreiteiro_da_obra|usuario_do_fornecedor|auth\.uid)'
      )
  ) then
    raise exception 'FALHA: há política em storage.objects dando acesso a bucket privado a quem não é equipe';
  end if;
  -- Etapa 4: envio, atualização e exclusão no bucket obras passam só pelo servidor; sobra a leitura da equipe.
  if (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'obras:%'
  ) <> 1 or not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'obras:%' and cmd = 'SELECT'
  ) then
    raise exception 'FALHA: o bucket obras deveria ter só a política de leitura da equipe';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'obras: staff envia',
        'obras: staff atualiza',
        'obras: staff apaga',
        'obras: leitura',
        'obras: staff ou autor do relato pendente envia',
        'documentos: cliente lê arquivo liberado do seu empreendimento',
        'fornecedores: usuário do fornecedor lê a própria pasta',
        'fornecedores: usuário do fornecedor envia para a própria pasta de documentos'
      )
  ) then
    raise exception 'FALHA: política de não-equipe em storage.objects deveria ter sido removida';
  end if;

  -- Fotos de relato e documentos de fornecedor: o único insert por RLS é o da equipe.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'relato_fotos'
      and cmd in ('INSERT', 'ALL') and coalesce(with_check, '') !~ 'e_staff|e_admin|tem_permissao'
  ) then
    raise exception 'FALHA: relato_fotos deveria ter só a política de insert da equipe';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fornecedor_documentos'
      and cmd in ('INSERT', 'ALL') and coalesce(with_check, '') !~ 'e_staff|tem_permissao' and policyname not like 'usuário do fornecedor%'
  ) then
    raise exception 'FALHA: fornecedor_documentos deveria ter só a política de insert da equipe';
  end if;

  -- Funções de trigger não são chamáveis por quem usa a API.
  if has_function_privilege('authenticated', 'public.carimbar_revisao()', 'execute')
     or has_function_privilege('anon', 'public.carimbar_revisao()', 'execute')
     or has_function_privilege('authenticated', 'public.carimbar_liberacao_documento()', 'execute')
     or has_function_privilege('authenticated', 'public.validar_caminho_foto_relato()', 'execute')
     or has_function_privilege('authenticated', 'public.validar_caminho_foto_atualizacao()', 'execute') then
    raise exception 'FALHA: função de trigger das correções executável por authenticated/anon';
  end if;

  if (
    select count(*) from public.modelos_etapas
    where nome in ('SAA', 'SES', 'PER', 'PEC', 'Termo de Acordo', 'Ordem de Serviço', 'Doação de Bens')
  ) <> 7 then
    raise exception 'FALHA: seed deveria ter os 7 modelos de etapas';
  end if;

  -- As categorias do seed são editadas pela tela (em 09/11 o dono trocou várias): confere só que os 7 modelos do
  -- seed continuam com categorias.
  if (select count(distinct c.modelo_id) from public.modelo_categorias_documento c) < 7 then
    raise exception 'FALHA: seed de categorias de documento incompleto';
  end if;
end $$;

update public.fornecedores set razao_social = 'Fornecedor A Teste Editado', atualizado_em = '2000-01-01'
where id = '00000000-0000-0000-0000-00000000f001';

do $$
begin
  if (select atualizado_em from public.fornecedores where id = '00000000-0000-0000-0000-00000000f001') < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em em fornecedores';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'fornecedores'
      and registro_id = '00000000-0000-0000-0000-00000000f001'
      and acao = 'UPDATE'
  ) then
    raise exception 'FALHA: update em fornecedores não gerou linha de auditoria';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'relatos_obra'
      and registro_id = '00000000-0000-0000-0000-00000000c0a1'
      and acao = 'INSERT'
  ) then
    raise exception 'FALHA: insert em relatos_obra não gerou linha de auditoria';
  end if;
end $$;

-- Cliente A: só o empreendimento A e o que é dele (atualizações publicadas,
-- relatos aprovados); nada de B; nada de escrita.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002c1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is distinct from 'cliente' then
    raise exception 'FALHA: papel_atual() do cliente A deveria ser cliente';
  end if;
  if not public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: cliente A deveria ser cliente do empreendimento A';
  end if;
  if public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a002') then
    raise exception 'FALHA: cliente A não pode ser cliente do empreendimento B';
  end if;
  if not public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a001')
     or public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a002') then
    raise exception 'FALHA: pode_ver_empreendimento do cliente A está errado';
  end if;
  if public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a1')
     or public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f001') then
    raise exception 'FALHA: cliente não é empreiteiro nem usuário de fornecedor';
  end if;

  if (select count(*) from public.empreendimentos) <> 1
     or not exists (select 1 from public.empreendimentos where id = '00000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: cliente A deveria ver só o empreendimento A';
  end if;
  if (select count(*) from public.empreendimento_clientes) <> 1 then
    raise exception 'FALHA: cliente A deveria ver só o próprio vínculo';
  end if;
  if (select count(*) from public.projetos) <> 1
     or not exists (select 1 from public.projetos where id = '00000000-0000-0000-0000-000000005001') then
    raise exception 'FALHA: cliente A deveria ver só o projeto A';
  end if;
  if (select count(*) from public.projeto_etapas) <> 2 then
    raise exception 'FALHA: cliente A deveria ver as 2 etapas do projeto A';
  end if;
  if (select count(*) from public.projeto_categorias_documento) <> 1 then
    raise exception 'FALHA: cliente A deveria ver 1 categoria de documento do projeto A';
  end if;
  if (select count(*) from public.atualizacoes) <> 1
     or not exists (select 1 from public.atualizacoes where id = '00000000-0000-0000-0000-00000000d0a1') then
    raise exception 'FALHA: cliente A deveria ver só a atualização A publicada';
  end if;
  if (select count(*) from public.atualizacao_fotos) <> 1 then
    raise exception 'FALHA: cliente A deveria ver só a foto da atualização publicada';
  end if;
  if (select count(*) from public.obras) <> 2
     or exists (select 1 from public.obras where id = '00000000-0000-0000-0000-00000000b0b1') then
    raise exception 'FALHA: cliente A deveria ver só as 2 obras do empreendimento A';
  end if;
  if (select count(*) from public.relatos_obra) <> 1
     or not exists (select 1 from public.relatos_obra where id = '00000000-0000-0000-0000-00000000c0a1') then
    raise exception 'FALHA: cliente A deveria ver só o relato aprovado da obra A1';
  end if;
  if (select count(*) from public.relato_fotos) <> 1 then
    raise exception 'FALHA: cliente A deveria ver só a foto do relato aprovado';
  end if;

  perform public.t_exige_vazio(
    array['fornecedores', 'fornecedor_usuarios', 'obra_empreiteiros', 'modelos_etapas',
          'modelo_etapas_itens', 'modelo_categorias_documento'],
    'cliente A'
  );
end $$;

-- Cliente A: storage. Mesmo a foto do relato aprovado e a da atualização publicada
-- só chegam ao cliente pela rota de servidor (URL assinada): por RLS ele não vê nenhum objeto.
do $$
begin
  if (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: cliente A não deveria ver nenhum objeto dos buckets privados, viu %',
      (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores'));
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'obras'
      and name = 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a1/etapa2-teste-f1.jpg'
  ) then
    raise exception 'FALHA: cliente A não pode ler por RLS nem a foto do relato aprovado';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'obras'
      and name = 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-f1.jpg'
  ) then
    raise exception 'FALHA: cliente A não pode ler por RLS nem a foto da atualização publicada';
  end if;
end $$;

-- Cliente A: não escreve nada.
do $$
begin
  perform public.t_exige_negado($q$insert into public.empreendimentos (nome) values ('Intruso')$q$, 'cliente criou empreendimento');
  perform public.t_exige_negado($q$update public.empreendimentos set nome = 'Intruso' where id = '00000000-0000-0000-0000-00000000a001'$q$, 'cliente editou empreendimento');
  perform public.t_exige_negado($q$delete from public.empreendimentos where id = '00000000-0000-0000-0000-00000000a001'$q$, 'cliente apagou empreendimento');
  perform public.t_exige_negado($q$insert into public.empreendimento_clientes (empreendimento_id, profile_id) values ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000002c1')$q$, 'cliente A se vinculou ao empreendimento B');
  perform public.t_exige_negado($q$delete from public.empreendimento_clientes where profile_id = '00000000-0000-0000-0000-0000000002c1'$q$, 'cliente apagou o próprio vínculo');
  perform public.t_exige_negado($q$insert into public.projetos (empreendimento_id, nome) values ('00000000-0000-0000-0000-00000000a001', 'Intruso')$q$, 'cliente criou projeto');
  perform public.t_exige_negado($q$update public.projetos set nome = 'Intruso' where id = '00000000-0000-0000-0000-000000005001'$q$, 'cliente editou projeto');
  perform public.t_exige_negado($q$update public.projeto_etapas set concluida_em = current_date where projeto_id = '00000000-0000-0000-0000-000000005001'$q$, 'cliente editou etapa');
  perform public.t_exige_negado($q$insert into public.atualizacoes (empreendimento_id, titulo, publicado) values ('00000000-0000-0000-0000-00000000a001', 'Intruso', true)$q$, 'cliente criou atualização');
  perform public.t_exige_negado($q$update public.atualizacoes set publicado = false where id = '00000000-0000-0000-0000-00000000d0a1'$q$, 'cliente editou atualização');
  perform public.t_exige_negado($q$delete from public.atualizacao_fotos$q$, 'cliente apagou foto de atualização');
  perform public.t_exige_negado($q$insert into public.obras (empreendimento_id, nome) values ('00000000-0000-0000-0000-00000000a001', 'Intruso')$q$, 'cliente criou obra');
  perform public.t_exige_negado($q$update public.obras set percentual = 100 where id = '00000000-0000-0000-0000-00000000b0a1'$q$, 'cliente editou obra');
  perform public.t_exige_negado($q$delete from public.obras where id = '00000000-0000-0000-0000-00000000b0a1'$q$, 'cliente apagou obra');
  perform public.t_exige_erro($q$insert into public.obra_empreiteiros (obra_id, profile_id) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002c1')$q$, '23514', 'vínculo de obra deveria recusar perfil cliente');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002c1', 'Intruso')$q$, 'cliente criou relato');
  perform public.t_exige_negado($q$update public.relatos_obra set status = 'devolvido', motivo_devolucao = 'x' where id = '00000000-0000-0000-0000-00000000c0a1'$q$, 'cliente alterou relato');
  perform public.t_exige_negado($q$delete from public.relatos_obra where id = '00000000-0000-0000-0000-00000000c0a1'$q$, 'cliente apagou relato');
  perform public.t_exige_negado($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values ('00000000-0000-0000-0000-00000000c0a2', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-intruso.jpg', 'image/jpeg', 1)$q$, 'cliente anexou foto a relato');
  perform public.t_exige_negado($q$delete from public.relato_fotos$q$, 'cliente apagou foto de relato');
  perform public.t_exige_negado($q$insert into public.fornecedores (razao_social) values ('Intruso')$q$, 'cliente criou fornecedor');
  perform public.t_exige_negado($q$insert into public.modelos_etapas (nome) values ('Intruso')$q$, 'cliente criou modelo');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-intruso.jpg')$q$, 'cliente enviou arquivo ao bucket obras');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-intruso.jpg')$q$, 'cliente enviou arquivo ao relato pendente');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('documentos', '00000000-0000-0000-0000-00000000a001/etapa2-teste-intruso.pdf')$q$, 'cliente enviou arquivo ao bucket documentos');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('fornecedores', '00000000-0000-0000-0000-00000000f001/documentos/etapa2-teste-intruso.pdf')$q$, 'cliente enviou arquivo ao bucket fornecedores');
  perform public.t_exige_negado($q$update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'obras'$q$, 'cliente alterou objeto do bucket obras');
  perform public.t_exige_erro(
    $q$select public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a001', gen_random_uuid(), 'Intruso')$q$,
    '42501',
    'cliente conseguiu chamar criar_projeto_de_modelo'
  );
end $$;

-- Cliente B: só o empreendimento B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002c2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.empreendimentos) <> 1
     or not exists (select 1 from public.empreendimentos where id = '00000000-0000-0000-0000-00000000a002') then
    raise exception 'FALHA: cliente B deveria ver só o empreendimento B';
  end if;
  if (select count(*) from public.projetos) <> 1
     or (select count(*) from public.obras) <> 1
     or (select count(*) from public.atualizacoes) <> 1
     or (select count(*) from public.relatos_obra) <> 1 then
    raise exception 'FALHA: cliente B deveria ver 1 projeto, 1 obra, 1 atualização e 1 relato (todos de B)';
  end if;
  if not exists (select 1 from public.relatos_obra where id = '00000000-0000-0000-0000-00000000c0b1') then
    raise exception 'FALHA: cliente B deveria ver o relato aprovado da obra B1';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: cliente B não deveria ver nenhum objeto dos buckets privados';
  end if;
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a002/00000000-0000-0000-0000-00000000d0b1/etapa2-teste-intruso.jpg')$q$, 'cliente B enviou arquivo ao bucket obras');
  if public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: cliente B não pode ser cliente do empreendimento A';
  end if;
end $$;

-- Empreiteiro 1 (obra A1): vê só a obra atribuída e os próprios relatos; insere
-- relato pendente só nela; não atualiza nem apaga; fotos só no relato pendente
-- próprio, no caminho certo, até 10.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002e1","role":"authenticated"}';

do $$
declare
  v_novo uuid;
begin
  if public.papel_atual() is distinct from 'empreiteiro' then
    raise exception 'FALHA: papel_atual() do empreiteiro 1 deveria ser empreiteiro';
  end if;
  if not public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a1')
     or public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a2')
     or public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0b1') then
    raise exception 'FALHA: empreiteiro_da_obra do empreiteiro 1 está errado';
  end if;
  if public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001')
     or public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: empreiteiro não é cliente nem vê empreendimento';
  end if;

  if (select count(*) from public.obras) <> 1
     or not exists (select 1 from public.obras where id = '00000000-0000-0000-0000-00000000b0a1') then
    raise exception 'FALHA: empreiteiro 1 deveria ver só a obra A1';
  end if;
  if (select count(*) from public.obra_empreiteiros) <> 1 then
    raise exception 'FALHA: empreiteiro 1 deveria ver só o próprio vínculo de obra';
  end if;
  if (select count(*) from public.relatos_obra) <> 3
     or exists (select 1 from public.relatos_obra where id = '00000000-0000-0000-0000-00000000c0b1') then
    raise exception 'FALHA: empreiteiro 1 deveria ver só os 3 relatos próprios';
  end if;
  if (select count(*) from public.relato_fotos) <> 2 then
    raise exception 'FALHA: empreiteiro 1 deveria ver só as 2 fotos dos relatos próprios';
  end if;
  if exists (select 1 from public.relatos_obra where id = '00000000-0000-0000-0000-00000000c0a4')
     or exists (select 1 from public.relato_fotos where relato_id = '00000000-0000-0000-0000-00000000c0a4') then
    raise exception 'FALHA: empreiteiro 1 não deveria ver o relato antigo de obra sem vínculo';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: empreiteiro 1 não deveria ver nenhum objeto dos buckets privados, viu %',
      (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores'));
  end if;
  perform public.t_exige_vazio(
    array['fornecedores', 'fornecedor_usuarios', 'empreendimentos', 'empreendimento_clientes',
          'modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento', 'projetos',
          'projeto_etapas', 'projeto_categorias_documento', 'atualizacoes', 'atualizacao_fotos'],
    'empreiteiro 1'
  );

  -- O relato só nasce pela RPC enviar_relato_obra: insert direto é negado, mesmo na obra atribuída.
  v_novo := gen_random_uuid();
  perform public.t_exige_negado(
    format($q$insert into public.relatos_obra (id, obra_id, autor_id, texto, percentual_informado, situacao_informada) values (%L, '00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'Novo relato', 40, 'em_andamento')$q$, v_novo),
    'empreiteiro inseriu relato direto na obra atribuída'
  );
  perform public.t_exige_negado(
    $q$insert into public.relatos_obra (obra_id, texto) values ('00000000-0000-0000-0000-00000000b0a1', 'Sem autor explícito')$q$,
    'empreiteiro inseriu relato direto com autor_id padrão'
  );
  if exists (select 1 from public.relatos_obra where id = v_novo) or (select count(*) from public.relatos_obra) <> 3 then
    raise exception 'FALHA: insert direto negado não deveria deixar relato do empreiteiro';
  end if;
  -- Os testes de foto abaixo usam o relato pendente próprio da fixture.
  v_novo := '00000000-0000-0000-0000-00000000c0a2';

  -- Obra errada, status/revisão preenchidos, autor trocado e data retroativa: tudo negado.
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000002e1', 'Obra sem vínculo')$q$, 'empreiteiro inseriu relato em obra do mesmo empreendimento sem vínculo');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000002e1', 'Obra de outro')$q$, 'empreiteiro inseriu relato em obra de outro empreendimento');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto, status) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'x', 'aprovado')$q$, 'empreiteiro inseriu relato já aprovado');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto, status) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'x', 'devolvido')$q$, 'empreiteiro inseriu relato devolvido');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto, motivo_devolucao) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'x', 'motivo')$q$, 'empreiteiro preencheu motivo_devolucao');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto, revisado_por) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'x', '00000000-0000-0000-0000-0000000002b1')$q$, 'empreiteiro preencheu revisado_por');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto, revisado_em) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'x', now())$q$, 'empreiteiro preencheu revisado_em');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e2', 'Em nome de outro')$q$, 'empreiteiro inseriu relato em nome de outro autor');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto, criado_em) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'x', '2020-01-01')$q$, 'empreiteiro retroagiu criado_em');

  -- Sem update nem delete, nem do próprio relato pendente.
  perform public.t_exige_negado($q$update public.relatos_obra set texto = 'editado' where id = '00000000-0000-0000-0000-00000000c0a2'$q$, 'empreiteiro editou relato');
  perform public.t_exige_negado($q$update public.relatos_obra set status = 'aprovado' where id = '00000000-0000-0000-0000-00000000c0a2'$q$, 'empreiteiro aprovou o próprio relato');
  perform public.t_exige_negado($q$delete from public.relatos_obra where id = '00000000-0000-0000-0000-00000000c0a2'$q$, 'empreiteiro apagou relato');
  perform public.t_exige_negado($q$update public.obras set percentual = 100 where id = '00000000-0000-0000-0000-00000000b0a1'$q$, 'empreiteiro editou obra');
  perform public.t_exige_negado($q$insert into public.obra_empreiteiros (obra_id, profile_id) values ('00000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000002e1')$q$, 'empreiteiro se vinculou a outra obra');
  perform public.t_exige_negado($q$delete from public.obra_empreiteiros$q$, 'empreiteiro apagou vínculo de obra');

  -- Fotos: o empreiteiro não insere relato_fotos nem com caminho correto, em relato
  -- pendente próprio (a rota de servidor insere com a secret key).
  perform public.t_exige_negado(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 1000)$q$,
      v_novo, 'relatos/00000000-0000-0000-0000-00000000b0a1/' || v_novo::text || '/etapa2-teste-ok.jpg'),
    'empreiteiro anexou foto ao relato pendente próprio'
  );
  perform public.t_exige_negado(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 1000)$q$,
      '00000000-0000-0000-0000-00000000c0a2', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-ok.jpg'),
    'empreiteiro anexou foto a relato pendente anterior'
  );
  perform public.t_exige_negado($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values ('00000000-0000-0000-0000-00000000c0a1', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a1/etapa2-teste-novo.jpg', 'image/jpeg', 1000)$q$, 'empreiteiro anexou foto a relato já aprovado');
  perform public.t_exige_negado($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values ('00000000-0000-0000-0000-00000000c0a3', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a3/etapa2-teste-novo.jpg', 'image/jpeg', 1000)$q$, 'empreiteiro anexou foto a relato devolvido');
  perform public.t_exige_negado($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values ('00000000-0000-0000-0000-00000000c0b1', 'relatos/00000000-0000-0000-0000-00000000b0b1/00000000-0000-0000-0000-00000000c0b1/etapa2-teste-novo.jpg', 'image/jpeg', 1000)$q$, 'empreiteiro anexou foto a relato de outro autor');
  perform public.t_exige_negado($q$delete from public.relato_fotos$q$, 'empreiteiro apagou foto de relato');
  perform public.t_exige_negado($q$update public.relato_fotos set mime = 'image/png'$q$, 'empreiteiro alterou foto de relato');

  -- Storage: nenhum envio por RLS, nem no relato pendente próprio; também negado
  -- em outra obra, relato alheio, relato aprovado/devolvido, atualizações e
  -- caminhos fora do padrão.
  perform public.t_exige_negado(
    format($q$insert into storage.objects (bucket_id, name) values ('obras', %L)$q$,
      'relatos/00000000-0000-0000-0000-00000000b0a1/' || v_novo::text || '/etapa2-teste-up.jpg'),
    'empreiteiro enviou arquivo ao próprio relato pendente'
  );
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('documentos', '00000000-0000-0000-0000-00000000a001/etapa2-teste-up.pdf')$q$, 'empreiteiro enviou arquivo ao bucket documentos');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('fornecedores', '00000000-0000-0000-0000-00000000f001/documentos/etapa2-teste-up.pdf')$q$, 'empreiteiro enviou arquivo ao bucket fornecedores');
  perform public.t_exige_negado(
    format($q$insert into storage.objects (bucket_id, name) values ('obras', %L)$q$,
      'relatos/00000000-0000-0000-0000-00000000b0a2/' || v_novo::text || '/etapa2-teste-up.jpg'),
    'empreiteiro enviou arquivo com a obra errada no caminho'
  );
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/00000000-0000-0000-0000-00000000b0b1/00000000-0000-0000-0000-00000000c0b1/etapa2-teste-up.jpg')$q$, 'empreiteiro enviou arquivo para obra de outro');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a1/etapa2-teste-up.jpg')$q$, 'empreiteiro enviou arquivo para relato aprovado');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a3/etapa2-teste-up.jpg')$q$, 'empreiteiro enviou arquivo para relato devolvido');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-up.jpg')$q$, 'empreiteiro enviou arquivo para atualização');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'etapa2-teste-solto.jpg')$q$, 'empreiteiro enviou arquivo na raiz do bucket');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/lixo/lixo/etapa2-teste-up.jpg')$q$, 'empreiteiro enviou arquivo com ids inválidos no caminho');
  perform public.t_exige_negado($q$update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'obras'$q$, 'empreiteiro alterou objeto do bucket obras');
end $$;

-- Empreiteiro 2 (obra B1): vê só a obra B1; não consegue usar a obra nem o relato de A.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002e2","role":"authenticated"}';

do $$
declare
  v_novo uuid;
begin
  if (select count(*) from public.obras) <> 1
     or not exists (select 1 from public.obras where id = '00000000-0000-0000-0000-00000000b0b1') then
    raise exception 'FALHA: empreiteiro 2 deveria ver só a obra B1';
  end if;
  if (select count(*) from public.relatos_obra) <> 1
     or (select count(*) from public.relato_fotos) <> 1 then
    raise exception 'FALHA: empreiteiro 2 deveria ver só o próprio relato e a própria foto';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: empreiteiro 2 não deveria ver nenhum objeto dos buckets privados';
  end if;

  v_novo := gen_random_uuid();
  perform public.t_exige_negado(
    format($q$insert into public.relatos_obra (id, obra_id, autor_id, texto) values (%L, '00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000002e2', 'Relato do empreiteiro 2')$q$, v_novo),
    'empreiteiro 2 inseriu relato direto na própria obra'
  );
  -- Sem relato pendente próprio da fixture: os testes de foto usam o relato próprio B1.
  v_novo := '00000000-0000-0000-0000-00000000c0b1';
  perform public.t_exige_negado(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 1000)$q$,
      v_novo, 'relatos/00000000-0000-0000-0000-00000000b0b1/' || v_novo::text || '/etapa2-teste-e2.jpg'),
    'empreiteiro 2 anexou foto ao próprio relato'
  );
  perform public.t_exige_negado(
    format($q$insert into storage.objects (bucket_id, name) values ('obras', %L)$q$,
      'relatos/00000000-0000-0000-0000-00000000b0b1/' || v_novo::text || '/etapa2-teste-e2.jpg'),
    'empreiteiro 2 enviou arquivo ao próprio relato'
  );
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e2', 'Obra de outro')$q$, 'empreiteiro 2 inseriu relato na obra A1');
  perform public.t_exige_negado($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values ('00000000-0000-0000-0000-00000000c0a2', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-e2.jpg', 'image/jpeg', 1000)$q$, 'empreiteiro 2 anexou foto a relato do empreiteiro 1');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/00000000-0000-0000-0000-00000000b0a1/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-e2.jpg')$q$, 'empreiteiro 2 enviou arquivo ao relato pendente do empreiteiro 1');
end $$;

-- Fornecedor A: só o próprio fornecedor; nada de escrita.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002f1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is distinct from 'fornecedor' then
    raise exception 'FALHA: papel_atual() do fornecedor A deveria ser fornecedor';
  end if;
  if not public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f001')
     or public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f002') then
    raise exception 'FALHA: usuario_do_fornecedor do fornecedor A está errado';
  end if;
  if public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001')
     or public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a1')
     or public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: fornecedor não é cliente nem empreiteiro';
  end if;

  if (select count(*) from public.fornecedores) <> 1
     or not exists (select 1 from public.fornecedores where id = '00000000-0000-0000-0000-00000000f001') then
    raise exception 'FALHA: fornecedor A deveria ver só o fornecedor A';
  end if;
  if (select count(*) from public.fornecedor_usuarios) <> 1 then
    raise exception 'FALHA: fornecedor A deveria ver só o próprio vínculo';
  end if;
  if (select count(*) from storage.objects where bucket_id in ('obras', 'documentos', 'fornecedores')) <> 0 then
    raise exception 'FALHA: fornecedor A não deveria ver nenhum objeto dos buckets privados';
  end if;
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('fornecedores', '00000000-0000-0000-0000-00000000f001/documentos/etapa2-teste-intruso.pdf')$q$, 'fornecedor A enviou arquivo à própria pasta de documentos');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-intruso.jpg')$q$, 'fornecedor A enviou arquivo ao bucket obras');
  perform public.t_exige_negado($q$insert into storage.objects (bucket_id, name) values ('documentos', '00000000-0000-0000-0000-00000000a001/etapa2-teste-intruso.pdf')$q$, 'fornecedor A enviou arquivo ao bucket documentos');
  perform public.t_exige_vazio(
    array['empreendimentos', 'empreendimento_clientes', 'modelos_etapas', 'modelo_etapas_itens',
          'modelo_categorias_documento', 'projetos', 'projeto_etapas', 'projeto_categorias_documento',
          'atualizacoes', 'atualizacao_fotos', 'obras', 'obra_empreiteiros', 'relatos_obra', 'relato_fotos'],
    'fornecedor A'
  );

  perform public.t_exige_negado($q$insert into public.fornecedores (razao_social) values ('Intruso')$q$, 'fornecedor criou fornecedor');
  perform public.t_exige_negado($q$update public.fornecedores set razao_social = 'Intruso' where id = '00000000-0000-0000-0000-00000000f001'$q$, 'fornecedor editou o próprio fornecedor');
  perform public.t_exige_negado($q$update public.fornecedores set razao_social = 'Intruso' where id = '00000000-0000-0000-0000-00000000f002'$q$, 'fornecedor editou outro fornecedor');
  perform public.t_exige_negado($q$delete from public.fornecedores where id = '00000000-0000-0000-0000-00000000f001'$q$, 'fornecedor apagou fornecedor');
  perform public.t_exige_negado($q$insert into public.fornecedor_usuarios (fornecedor_id, profile_id) values ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000002f1')$q$, 'fornecedor A se vinculou ao fornecedor B');
  perform public.t_exige_negado($q$update public.fornecedor_usuarios set fornecedor_id = '00000000-0000-0000-0000-00000000f002'$q$, 'fornecedor A trocou o próprio vínculo');
  perform public.t_exige_negado($q$delete from public.fornecedor_usuarios$q$, 'fornecedor A apagou vínculo');
  perform public.t_exige_negado($q$insert into public.empreendimentos (nome) values ('Intruso')$q$, 'fornecedor criou empreendimento');
end $$;

-- Fornecedor B: só o fornecedor B.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002f2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.fornecedores) <> 1
     or not exists (select 1 from public.fornecedores where id = '00000000-0000-0000-0000-00000000f002') then
    raise exception 'FALHA: fornecedor B deveria ver só o fornecedor B';
  end if;
  if public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f001') then
    raise exception 'FALHA: fornecedor B não pode ser usuário do fornecedor A';
  end if;
end $$;

-- Conta com troca de senha pendente (cliente do empreendimento A): nada de acesso.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002d1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is not null then
    raise exception 'FALHA: papel_atual() com troca de senha pendente deveria ser nulo';
  end if;
  if public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001')
     or public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a001')
     or public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a1')
     or public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f001') then
    raise exception 'FALHA: conta com troca de senha pendente não pode passar nas funções de acesso';
  end if;
  perform public.t_exige_vazio(public.t_tabelas(), 'conta com troca de senha pendente');
  if (select count(*) from storage.objects where bucket_id = 'obras') <> 0 then
    raise exception 'FALHA: conta com troca de senha pendente não deveria ver objetos do bucket obras';
  end if;
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002d1', 'Intruso')$q$, 'conta pendente criou relato');
  perform public.t_exige_negado($q$insert into public.empreendimentos (nome) values ('Intruso')$q$, 'conta pendente criou empreendimento');
end $$;

-- Equipe: lê e escreve em tudo, inclusive revisar relato, e cria projeto a partir de modelo.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002b1","role":"authenticated"}';

do $$
declare
  v_emp uuid;
  v_obra uuid;
  v_forn uuid;
  v_atu uuid;
  v_relato uuid;
  v_modelo uuid;
  v_modelo_saa uuid;
  v_proj uuid;
  v_proj2 uuid;
  v_etapa1 uuid;
begin
  if not public.e_staff() or public.e_admin() then
    raise exception 'FALHA: equipe deveria ser staff e não admin';
  end if;
  if not public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a001')
     or not public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a002') then
    raise exception 'FALHA: staff deveria poder ver todos os empreendimentos';
  end if;
  if public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: equipe não é cliente do empreendimento';
  end if;

  if (select count(*) from public.empreendimentos where id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')) <> 2
     or (select count(*) from public.empreendimento_clientes where empreendimento_id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')) <> 3
     or (select count(*) from public.fornecedores where id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002')) <> 2
     or (select count(*) from public.fornecedor_usuarios where fornecedor_id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002')) <> 2
     or (select count(*) from public.projetos where empreendimento_id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')) <> 2
     or (select count(*) from public.projeto_etapas where projeto_id in ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000005002')) <> 3
     or (select count(*) from public.projeto_categorias_documento where projeto_id in ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-000000005002')) <> 2
     or (select count(*) from public.atualizacoes where empreendimento_id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')) <> 3
     or (select count(*) from public.atualizacao_fotos where storage_path like '%etapa2-teste-f1.jpg') <> 3
     or (select count(*) from public.obras where empreendimento_id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')) <> 3
     or (select count(*) from public.obra_empreiteiros where obra_id in ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0b1')) <> 2
     or (select count(*) from public.relatos_obra where id in ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000c0b1')) <> 4
     or (select count(*) from public.relato_fotos where storage_path like '%etapa2-teste-f1.jpg') <> 3 then
    raise exception 'FALHA: equipe deveria ver todas as linhas de fixture';
  end if;
  if (select count(*) from public.modelos_etapas) < 7 then
    raise exception 'FALHA: equipe deveria ver os modelos de etapas';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'obras' and name like '%etapa2-teste-f_.jpg') <> 7 then
    raise exception 'FALHA: equipe deveria ver os 7 objetos de fixture do bucket obras';
  end if;

  -- Empreendimento, vínculos, obras e relatos.
  insert into public.empreendimentos (nome) values ('Empreendimento Equipe Teste') returning id into v_emp;
  perform public.t_exige_linhas(format($q$update public.empreendimentos set cidade = 'Nova' where id = %L$q$, v_emp), 1, 'equipe deveria editar empreendimento');
  perform public.t_exige_linhas(format($q$insert into public.empreendimento_clientes (empreendimento_id, profile_id) values (%L, '00000000-0000-0000-0000-0000000002c2')$q$, v_emp), 1, 'equipe deveria vincular cliente');
  perform public.t_exige_linhas(format($q$delete from public.empreendimento_clientes where empreendimento_id = %L$q$, v_emp), 1, 'equipe deveria desvincular cliente');

  insert into public.obras (empreendimento_id, nome) values (v_emp, 'Obra Equipe Teste') returning id into v_obra;
  perform public.t_exige_linhas(format($q$update public.obras set percentual = 50, situacao = 'em_andamento' where id = %L$q$, v_obra), 1, 'equipe deveria editar obra');
  perform public.t_exige_linhas(format($q$insert into public.obra_empreiteiros (obra_id, profile_id) values (%L, '00000000-0000-0000-0000-0000000002e1')$q$, v_obra), 1, 'equipe deveria vincular empreiteiro');
  perform public.t_exige_linhas(format($q$delete from public.obra_empreiteiros where obra_id = %L$q$, v_obra), 1, 'equipe deveria desvincular empreiteiro');

  -- Etapa 8 (R39): criar relato é só do admin (o relato nasce por enviar_relato_obra, como o empreiteiro); aqui o admin lança
  -- e a equipe, que revisa, é recusada ao tentar o mesmo.
  perform public.t_exige_negado(
    format($q$insert into public.relatos_obra (obra_id, autor_id, texto) values (%L, '00000000-0000-0000-0000-0000000002e1', 'Relato lançado pela equipe')$q$, v_obra),
    'equipe criou relato (só o admin cria)'
  );
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}', true);
  insert into public.relatos_obra (obra_id, autor_id, texto, status, revisado_por, revisado_em)
  values (v_obra, '00000000-0000-0000-0000-0000000002e1', 'Relato lançado pelo admin', 'aprovado', '00000000-0000-0000-0000-0000000002b1', now())
  returning id into v_relato;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002b1","role":"authenticated"}', true);
  -- Carimbo de revisão: revisado_por/revisado_em forjados são trocados pelo usuário e por now().
  perform public.t_exige_linhas(
    $q$update public.relatos_obra set status = 'devolvido', motivo_devolucao = 'Mais fotos', revisado_por = '00000000-0000-0000-0000-0000000002a1', revisado_em = '2000-01-01' where id = '00000000-0000-0000-0000-00000000c0a2'$q$,
    1, 'equipe deveria devolver relato pendente'
  );
  if not exists (
    select 1 from public.relatos_obra
    where id = '00000000-0000-0000-0000-00000000c0a2'
      and status = 'devolvido'
      and revisado_por = '00000000-0000-0000-0000-0000000002b1'
      and revisado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: o carimbo de revisão do relato deveria usar o usuário logado e now(), não o que veio no update';
  end if;
  -- Etapa 5: o conteúdo enviado é imutável, mesmo para a equipe.
  perform public.t_exige_erro(
    $q$update public.relatos_obra set texto = 'Relato A1 devolvido (editado)', revisado_por = '00000000-0000-0000-0000-0000000002a1', revisado_em = '2000-01-01' where id = '00000000-0000-0000-0000-00000000c0a3'$q$,
    '23514', 'equipe não deveria editar o texto de relato devolvido'
  );
  if not exists (
    select 1 from public.relatos_obra
    where id = '00000000-0000-0000-0000-00000000c0a3'
      and texto = 'Relato A1 devolvido'
      and status = 'devolvido'
      and revisado_por = '00000000-0000-0000-0000-0000000002b1'
      and revisado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: edição recusada deveria preservar o relato e o carimbo de revisão';
  end if;

  -- Etapa 8 (R39): as fotos do relato são da rota (secret key) e do admin; a equipe não grava, mesmo com as 22 permissões.
  perform public.t_exige_negado(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/' || v_obra::text || '/' || v_relato::text || '/etapa2-teste-equipe.jpg'),
    'equipe anexou foto a relato (só o admin anexa)'
  );
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}', true);

  -- Fotos: o admin anexa com o caminho do próprio relato; caminho de outro dono, '..' e '//' são recusados.
  perform public.t_exige_linhas(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/' || v_obra::text || '/' || v_relato::text || '/etapa2-teste-staff.jpg'),
    1, 'admin deveria anexar foto a relato'
  );
  perform public.t_exige_erro(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/00000000-0000-0000-0000-00000000b0a1/' || v_relato::text || '/etapa2-teste-errado.jpg'),
    '23514', 'foto de relato com a obra de outro dono no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/' || v_obra::text || '/00000000-0000-0000-0000-00000000c0a2/etapa2-teste-errado.jpg'),
    '23514', 'foto de relato com o id de outro relato no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/x/y/etapa2-teste-errado.jpg'),
    '23514', 'foto de relato com caminho fora do padrão deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/' || v_obra::text || '/' || v_relato::text || '/../etapa2-teste-errado.jpg'),
    '23514', 'foto de relato com .. no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_relato, 'relatos/' || v_obra::text || '/' || v_relato::text || '//etapa2-teste-errado.jpg'),
    '23514', 'foto de relato com // no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$update public.relato_fotos set storage_path = %L where relato_id = %L$q$,
      'relatos/00000000-0000-0000-0000-00000000b0a1/' || v_relato::text || '/etapa2-teste-errado.jpg', v_relato),
    '42501', 'trocar o caminho da foto de relato deveria ser recusado (relato_fotos não tem grant de update)'
  );

  -- Limite de 10 fotos por relato (a equipe e a rota de servidor passam pelo mesmo trigger).
  perform public.t_exige_linhas(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho)
      select %L::uuid, 'relatos/' || %L || '/' || %L || '/etapa2-teste-n' || g || '.jpg', 'image/jpeg', 1000
      from generate_series(1, 9) as g$q$, v_relato, v_obra::text, v_relato::text),
    9, 'equipe deveria chegar a 10 fotos no relato'
  );
  perform public.t_exige_erro(
    format($q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 1000)$q$,
      v_relato, 'relatos/' || v_obra::text || '/' || v_relato::text || '/etapa2-teste-11.jpg'),
    '23514',
    'a 11ª foto do relato deveria ser recusada'
  );
  if (select count(*) from public.relato_fotos where relato_id = v_relato) <> 10 then
    raise exception 'FALHA: relato deveria ficar com exatamente 10 fotos';
  end if;

  -- Etapa 8 (R39): apagar fotos e relato é só do admin; a equipe não apaga nada (nenhuma linha afetada).
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002b1","role":"authenticated"}', true);
  perform public.t_exige_negado(format($q$delete from public.relato_fotos where relato_id = %L$q$, v_relato), 'equipe apagou fotos de relato (só o admin apaga)');
  perform public.t_exige_negado(format($q$delete from public.relatos_obra where id = %L$q$, v_relato), 'equipe apagou relato (só o admin apaga)');
  if (select count(*) from public.relato_fotos where relato_id = v_relato) <> 10 then
    raise exception 'FALHA: a equipe apagou fotos de relato';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}', true);
  perform public.t_exige_linhas(format($q$delete from public.relato_fotos where relato_id = %L$q$, v_relato), 10, 'admin deveria apagar as fotos de relato');
  perform public.t_exige_linhas(format($q$delete from public.relatos_obra where id = %L$q$, v_relato), 1, 'admin deveria apagar relato');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002b1","role":"authenticated"}', true);

  -- Atualização com autor padrão, fotos e publicação.
  insert into public.atualizacoes (empreendimento_id, titulo) values (v_emp, 'Atualização Equipe Teste') returning id into v_atu;
  if (select criado_por from public.atualizacoes where id = v_atu) is distinct from '00000000-0000-0000-0000-0000000002b1'::uuid then
    raise exception 'FALHA: criado_por da atualização deveria ser o usuário logado';
  end if;
  perform public.t_exige_linhas(format($q$update public.atualizacoes set publicado = true where id = %L$q$, v_atu), 1, 'equipe deveria publicar atualização');
  perform public.t_exige_linhas(
    format($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_atu, 'atualizacoes/' || v_emp::text || '/' || v_atu::text || '/etapa2-teste-staff.jpg'),
    1, 'equipe deveria anexar foto a atualização'
  );
  perform public.t_exige_erro(
    format($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_atu, 'atualizacoes/00000000-0000-0000-0000-00000000a001/' || v_atu::text || '/etapa2-teste-errado.jpg'),
    '23514', 'foto de atualização com o empreendimento de outro dono no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_atu, 'atualizacoes/' || v_emp::text || '/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-errado.jpg'),
    '23514', 'foto de atualização com o id de outra atualização no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_atu, 'relatos/' || v_emp::text || '/' || v_atu::text || '/etapa2-teste-errado.jpg'),
    '23514', 'foto de atualização com caminho de relato deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_atu, 'atualizacoes/' || v_emp::text || '/' || v_atu::text || '/../etapa2-teste-errado.jpg'),
    '23514', 'foto de atualização com .. no caminho deveria ser recusada'
  );
  perform public.t_exige_erro(
    format($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values (%L, %L, 'image/jpeg', 10)$q$,
      v_atu, 'atualizacoes/' || v_emp::text || '/' || v_atu::text || '//etapa2-teste-errado.jpg'),
    '23514', 'foto de atualização com // no caminho deveria ser recusada'
  );
  perform public.t_exige_linhas(format($q$delete from public.atualizacao_fotos where atualizacao_id = %L$q$, v_atu), 1, 'equipe deveria apagar foto de atualização');
  perform public.t_exige_linhas(format($q$delete from public.atualizacoes where id = %L$q$, v_atu), 1, 'equipe deveria apagar atualização');

  -- Fornecedores.
  insert into public.fornecedores (razao_social) values ('Fornecedor Equipe Teste') returning id into v_forn;
  perform public.t_exige_linhas(format($q$insert into public.fornecedor_usuarios (fornecedor_id, profile_id) values (%L, '00000000-0000-0000-0000-0000000002f2')$q$, v_forn), 1, 'equipe deveria vincular usuário a fornecedor');
  perform public.t_exige_linhas(format($q$update public.fornecedores set ativo = false where id = %L$q$, v_forn), 1, 'equipe deveria editar fornecedor');
  -- Etapa 8 (R11): apagar o cadastro de fornecedor exige fornecedores.excluir; esta conta tem o catálogo inteiro, então apaga.
  -- A recusa para quem não tem a permissão está em etapa8_permissoes_exclusao.sql.
  perform public.t_exige_linhas(format($q$delete from public.fornecedores where id = %L$q$, v_forn), 1, 'equipe com fornecedores.excluir deveria apagar fornecedor');
  insert into public.fornecedores (razao_social) values ('Fornecedor Admin Teste') returning id into v_forn;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}', true);
  perform public.t_exige_linhas(format($q$delete from public.fornecedores where id = %L$q$, v_forn), 1, 'admin deveria apagar fornecedor');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000002b1","role":"authenticated"}', true);

  -- Etapa 4: uploads e alterações de bytes passam exclusivamente pelo servidor.
  perform public.t_exige_negado(
    $q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/00000000-0000-0000-0000-00000000a001/00000000-0000-0000-0000-00000000d0a1/etapa2-teste-staff.jpg')$q$,
    'equipe conseguiu enviar diretamente ao bucket obras'
  );
  perform public.t_exige_negado(
    $q$update storage.objects set metadata = '{"etapa2":true}'::jsonb where bucket_id = 'obras' and name like '%etapa2-teste-f_.jpg'$q$,
    'equipe conseguiu atualizar diretamente objeto do bucket obras'
  );

  -- Modelo próprio de teste, com itens e categorias.
  insert into public.modelos_etapas (nome) values ('Modelo Equipe Teste') returning id into v_modelo;
  perform public.t_exige_linhas(
    format($q$insert into public.modelo_etapas_itens (modelo_id, nome, ordem) values (%L, 'Levantamento', 1), (%L, 'Execução', 2)$q$, v_modelo, v_modelo),
    2, 'equipe deveria cadastrar itens de modelo'
  );
  perform public.t_exige_linhas(
    format($q$insert into public.modelo_categorias_documento (modelo_id, nome, ordem) values (%L, 'Documentos', 1), (%L, 'Laudos', 2)$q$, v_modelo, v_modelo),
    2, 'equipe deveria cadastrar categorias de modelo'
  );

  -- criar_projeto_de_modelo com itens: copia etapas e categorias e aponta etapa_atual_id para a 1ª.
  v_proj := public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a001', v_modelo, 'Projeto Modelo Teste');
  if not exists (
    select 1 from public.projetos
    where id = v_proj
      and empreendimento_id = '00000000-0000-0000-0000-00000000a001'
      and modelo_origem_id = v_modelo
      and nome = 'Projeto Modelo Teste'
  ) then
    raise exception 'FALHA: criar_projeto_de_modelo não criou o projeto esperado';
  end if;
  if (select array_agg(nome order by ordem) from public.projeto_etapas where projeto_id = v_proj) is distinct from array['Levantamento', 'Execução'] then
    raise exception 'FALHA: criar_projeto_de_modelo não copiou as etapas do modelo';
  end if;
  if (select array_agg(nome order by ordem) from public.projeto_categorias_documento where projeto_id = v_proj) is distinct from array['Documentos', 'Laudos'] then
    raise exception 'FALHA: criar_projeto_de_modelo não copiou as categorias do modelo';
  end if;
  select id into v_etapa1 from public.projeto_etapas where projeto_id = v_proj and ordem = 1;
  if (select etapa_atual_id from public.projetos where id = v_proj) is distinct from v_etapa1 then
    raise exception 'FALHA: etapa_atual_id deveria ser a primeira etapa copiada';
  end if;

  -- Sem itens (modelo do seed): copia as categorias e deixa etapa_atual_id nulo.
  select id into v_modelo_saa from public.modelos_etapas where nome = 'SAA';
  v_proj2 := public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a001', v_modelo_saa, 'Projeto SAA Teste');
  if (select array_agg(nome order by ordem) from public.projeto_categorias_documento where projeto_id = v_proj2)
     is distinct from array['Contratos', 'Projetos', 'Laudos', 'Outros'] then
    raise exception 'FALHA: projeto de SAA deveria ter as categorias Contratos, Projetos, Laudos e Outros';
  end if;
  if (select count(*) from public.projeto_etapas where projeto_id = v_proj2) <> (select count(*) from public.modelo_etapas_itens where modelo_id = v_modelo_saa) then
    raise exception 'FALHA: projeto de SAA deveria ter as etapas que o modelo tem';
  end if;
  if not exists (select 1 from public.projetos where id = v_proj2 and modelo_origem_id = v_modelo_saa)
     or (
       (select count(*) from public.modelo_etapas_itens where modelo_id = v_modelo_saa) = 0
       and (select etapa_atual_id from public.projetos where id = v_proj2) is not null
     ) then
    raise exception 'FALHA: projeto de modelo sem itens deveria ficar sem etapa atual';
  end if;

  perform public.t_exige_erro(
    $q$select public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a001', null, 'Sem modelo')$q$,
    '22004', 'criar_projeto_de_modelo deveria exigir o modelo'
  );
  perform public.t_exige_erro(
    format($q$select public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a001', %L, 'Projeto Modelo Teste')$q$, v_modelo),
    '23505', 'criar_projeto_de_modelo deveria recusar nome repetido no empreendimento'
  );

  -- Projetos: edição e remoção em cascata.
  perform public.t_exige_linhas(format($q$update public.projeto_etapas set concluida_em = current_date where id = %L$q$, v_etapa1), 1, 'equipe deveria concluir etapa');
  perform public.t_exige_linhas(format($q$delete from public.projetos where id = %L$q$, v_proj), 1, 'equipe deveria apagar projeto');
  if exists (select 1 from public.projeto_etapas where projeto_id = v_proj)
     or exists (select 1 from public.projeto_categorias_documento where projeto_id = v_proj) then
    raise exception 'FALHA: apagar o projeto deveria apagar etapas e categorias em cascata';
  end if;
end $$;

-- Admin: mesmas capacidades da equipe.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}';

do $$
declare
  v_proj uuid;
  v_modelo uuid;
begin
  if not public.e_admin() or not public.e_staff() then
    raise exception 'FALHA: admin deveria ser staff e admin';
  end if;
  if (select count(*) from public.relatos_obra where id in ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000c0b1')) <> 4
     or (select count(*) from public.empreendimentos where id in ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')) <> 2 then
    raise exception 'FALHA: admin deveria ver todas as linhas de fixture';
  end if;
  select id into v_modelo from public.modelos_etapas where nome = 'Ordem de Serviço';
  v_proj := public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a002', v_modelo, 'Projeto OS Teste');
  -- O projeto copia as categorias do modelo (que o admin edita pela tela; não dá para fixar os nomes aqui).
  if (select array_agg(nome order by ordem) from public.projeto_categorias_documento where projeto_id = v_proj)
     is distinct from (select array_agg(nome order by ordem) from public.modelo_categorias_documento where modelo_id = v_modelo)
     or not exists (select 1 from public.projeto_categorias_documento where projeto_id = v_proj) then
    raise exception 'FALHA: projeto de Ordem de Serviço deveria copiar as categorias do modelo';
  end if;
  perform public.t_exige_erro(
    $q$update public.relatos_obra set status = 'aprovado', revisado_por = '00000000-0000-0000-0000-0000000002b1', revisado_em = '2000-01-01' where id = '00000000-0000-0000-0000-00000000c0a2'$q$,
    '55000', 'admin não deveria aprovar relato já devolvido'
  );
  if not exists (
    select 1 from public.relatos_obra
    where id = '00000000-0000-0000-0000-00000000c0a2'
      and status = 'devolvido'
      and motivo_devolucao = 'Mais fotos'
      and revisado_por = '00000000-0000-0000-0000-0000000002b1'
      and revisado_em > '2001-01-01'
  ) then
    raise exception 'FALHA: nova revisão recusada deveria preservar a devolução e o revisor original';
  end if;
  perform public.t_exige_linhas($q$delete from public.empreendimentos where id = '00000000-0000-0000-0000-00000000a002'$q$, 1, 'admin deveria apagar empreendimento');
end $$;

-- Empreiteiro 1 desvinculado da obra A1: continua com papel, mas os relatos que
-- escreveu (inclusive o aprovado e as fotos) deixam de ser visíveis, e ele não cria relato novo.
reset role;
delete from public.obra_empreiteiros
where obra_id = '00000000-0000-0000-0000-00000000b0a1'
  and profile_id = '00000000-0000-0000-0000-0000000002e1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002e1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is distinct from 'empreiteiro' then
    raise exception 'FALHA: empreiteiro 1 desvinculado ainda deveria ter o papel empreiteiro';
  end if;
  if public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a1') then
    raise exception 'FALHA: empreiteiro 1 não deveria mais ser empreiteiro da obra A1';
  end if;
  perform public.t_exige_vazio(array['obras', 'obra_empreiteiros', 'relatos_obra', 'relato_fotos'], 'empreiteiro 1 desvinculado');
  perform public.t_exige_negado($q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000002e1', 'Depois de desvinculado')$q$, 'empreiteiro desvinculado criou relato');
end $$;

-- Fornecedor A inativo: continua com papel, mas usuario_do_fornecedor() fecha e ele
-- deixa de ver o próprio fornecedor.
reset role;
update public.fornecedores set ativo = false where id = '00000000-0000-0000-0000-00000000f001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002f1","role":"authenticated"}';

do $$
begin
  if public.papel_atual() is distinct from 'fornecedor' then
    raise exception 'FALHA: fornecedor A inativo ainda deveria ter o papel fornecedor';
  end if;
  if public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f001') then
    raise exception 'FALHA: usuário de fornecedor inativo não deveria passar em usuario_do_fornecedor';
  end if;
  perform public.t_exige_vazio(array['fornecedores'], 'fornecedor A inativo');
end $$;

-- Fornecedor B (ativo) segue normal.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002f2","role":"authenticated"}';

do $$
begin
  if not public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f002')
     or (select count(*) from public.fornecedores) <> 1 then
    raise exception 'FALHA: fornecedor B ativo deveria continuar vendo o próprio fornecedor';
  end if;
end $$;

-- Anônimo: nenhuma tabela, nenhuma função de negócio, nenhum objeto do bucket obras.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare
  v_tabela text;
  v_conta bigint;
begin
  foreach v_tabela in array public.t_tabelas() loop
    begin
      execute format('select count(*) from public.%I', v_tabela);
      raise exception 'FALHA: anon conseguiu ler %', v_tabela;
    exception when insufficient_privilege then
      null;
    end;
  end loop;

  begin
    perform public.cliente_do_empreendimento('00000000-0000-0000-0000-00000000a001');
    raise exception 'FALHA: anon conseguiu chamar cliente_do_empreendimento';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.empreiteiro_da_obra('00000000-0000-0000-0000-00000000b0a1');
    raise exception 'FALHA: anon conseguiu chamar empreiteiro_da_obra';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.usuario_do_fornecedor('00000000-0000-0000-0000-00000000f001');
    raise exception 'FALHA: anon conseguiu chamar usuario_do_fornecedor';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.pode_ver_empreendimento('00000000-0000-0000-0000-00000000a001');
    raise exception 'FALHA: anon conseguiu chamar pode_ver_empreendimento';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.criar_projeto_de_modelo('00000000-0000-0000-0000-00000000a001', gen_random_uuid(), 'Intruso');
    raise exception 'FALHA: anon conseguiu chamar criar_projeto_de_modelo';
  exception when insufficient_privilege then
    null;
  end;

  begin
    select count(*) into v_conta from storage.objects where bucket_id = 'obras';
    if v_conta <> 0 then
      raise exception 'FALHA: anon não deveria ver objetos do bucket obras';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: todas as verificações de RLS da Etapa 2 (operação) passaram' as resultado;

rollback;
