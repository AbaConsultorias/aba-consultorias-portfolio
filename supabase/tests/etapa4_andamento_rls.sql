-- Testes da Etapa 4, frente A (andamento): vínculos, RPCs, auditoria e Storage.
-- Como rodar (somente em banco de TESTE, nunca em produção):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa4_andamento_rls.sql
-- Rode com o usuário postgres, depois de TODAS as migrations, inclusive
-- 20261030100000_etapa4_portal.sql. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK. Se alguma verificação falhar, o script para com "FALHA: ..."; se chegar
-- ao fim, o último SELECT imprime "OK".
-- Storage: sem políticas de envio/atualização/exclusão nos buckets documentos e obras;
-- só leitura da equipe. Remoção direta em storage.objects não é testada (o Supabase a
-- bloqueia por SQL), então a ausência da política DELETE é conferida no catálogo.
-- Contas com precisa_trocar_senha = true também ficam sem papel no banco (papel_atual() exige
-- ativo e senha já trocada, migration 20261027150000), além do guard da aplicação. Aqui,
-- "inativo" e "vínculo removido" cobrem a revogação feita pelo banco.

begin;

create function public.t4a_tabelas()
returns text[]
language sql
immutable
as $$
  select array[
    'empreendimentos', 'empreendimento_clientes', 'modelos_etapas', 'modelo_etapas_itens',
    'modelo_categorias_documento', 'projetos', 'projeto_etapas', 'projeto_categorias_documento',
    'atualizacoes', 'atualizacao_fotos', 'obras', 'relatos_obra', 'relato_fotos'
  ]
$$;

create function public.t4a_exige_negado(p_sql text, p_msg text)
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

create function public.t4a_exige_erro(p_sql text, p_estados text[], p_msg text)
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

create function public.t4a_exige_linhas(p_sql text, p_esperado bigint, p_msg text)
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

create function public.t4a_exige_vazio(p_tabelas text[], p_quem text)
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

create function public.t4a_exige_conta(p_sql text, p_esperado bigint, p_msg text)
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

grant execute on function public.t4a_tabelas() to anon, authenticated;
grant execute on function public.t4a_exige_negado(text, text) to anon, authenticated;
grant execute on function public.t4a_exige_erro(text, text[], text) to anon, authenticated;
grant execute on function public.t4a_exige_linhas(text, bigint, text) to anon, authenticated;
grant execute on function public.t4a_exige_vazio(text[], text) to anon, authenticated;
grant execute on function public.t4a_exige_conta(text, bigint, text) to anon, authenticated;

-- Fixture: uma conta por papel. Cliente A e B, cliente inativo e cliente com vínculo
-- que a equipe remove no meio do teste; empreiteiro; fornecedores A, B e inativo.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000004c1', 'authenticated', 'authenticated', 'cliente-a-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004c2', 'authenticated', 'authenticated', 'cliente-b-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004c3', 'authenticated', 'authenticated', 'cliente-revogado-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004c4', 'authenticated', 'authenticated', 'cliente-inativo-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004e1', 'authenticated', 'authenticated', 'empreiteiro-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004f1', 'authenticated', 'authenticated', 'fornecedor-a-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004f2', 'authenticated', 'authenticated', 'fornecedor-b-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004f3', 'authenticated', 'authenticated', 'fornecedor-inativo-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004b1', 'authenticated', 'authenticated', 'equipe-etapa4a@example.com'),
  ('00000000-0000-0000-0000-0000000004a1', 'authenticated', 'authenticated', 'admin-etapa4a@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000004c1', 'cliente', 'Cliente A Teste', true, false),
  ('00000000-0000-0000-0000-0000000004c2', 'cliente', 'Cliente B Teste', true, false),
  ('00000000-0000-0000-0000-0000000004c3', 'cliente', 'Cliente Revogado Teste', true, false),
  ('00000000-0000-0000-0000-0000000004c4', 'cliente', 'Cliente Inativo Teste', false, false),
  ('00000000-0000-0000-0000-0000000004e1', 'empreiteiro', 'Empreiteiro Teste', true, false),
  ('00000000-0000-0000-0000-0000000004f1', 'fornecedor', 'Fornecedor A Teste', true, false),
  ('00000000-0000-0000-0000-0000000004f2', 'fornecedor', 'Fornecedor B Teste', true, false),
  ('00000000-0000-0000-0000-0000000004f3', 'fornecedor', 'Fornecedor Inativo Teste', false, false),
  ('00000000-0000-0000-0000-0000000004b1', 'equipe', 'Equipe Teste', true, false),
  ('00000000-0000-0000-0000-0000000004a1', 'admin', 'Admin Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000004b1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome, cidade)
values
  ('40000000-0000-0000-0000-00000000a001', 'Empreendimento A Etapa4 Teste', 'Cidade A'),
  ('40000000-0000-0000-0000-00000000a002', 'Empreendimento B Etapa4 Teste', 'Cidade B');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('40000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000004c1'),
  ('40000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000004c2'),
  ('40000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000004c3'),
  ('40000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000004c4');

insert into public.fornecedores (id, razao_social, cnpj)
values
  ('40000000-0000-0000-0000-00000000f001', 'Fornecedor A Etapa4 Teste Ltda', '40000000000191'),
  ('40000000-0000-0000-0000-00000000f002', 'Fornecedor B Etapa4 Teste Ltda', '40000000000272'),
  ('40000000-0000-0000-0000-00000000f003', 'Fornecedor Inativo Etapa4 Teste Ltda', '40000000000353');

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values
  ('40000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000004f1'),
  ('40000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000004f2'),
  ('40000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000004f3');

insert into public.projetos (id, empreendimento_id, nome)
values
  ('40000000-0000-0000-0000-000000005001', '40000000-0000-0000-0000-00000000a001', 'Projeto A Etapa4 Teste'),
  ('40000000-0000-0000-0000-000000005002', '40000000-0000-0000-0000-00000000a002', 'Projeto B Etapa4 Teste');

insert into public.projeto_etapas (id, projeto_id, nome, ordem)
values
  ('40000000-0000-0000-0000-00000000e0a1', '40000000-0000-0000-0000-000000005001', 'Etapa A1', 1),
  ('40000000-0000-0000-0000-00000000e0a2', '40000000-0000-0000-0000-000000005001', 'Etapa A2', 2),
  ('40000000-0000-0000-0000-00000000e0b1', '40000000-0000-0000-0000-000000005002', 'Etapa B1', 1);

update public.projetos set etapa_atual_id = '40000000-0000-0000-0000-00000000e0a1'
where id = '40000000-0000-0000-0000-000000005001';
update public.projetos set etapa_atual_id = '40000000-0000-0000-0000-00000000e0b1'
where id = '40000000-0000-0000-0000-000000005002';

insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values
  ('40000000-0000-0000-0000-00000000ca01', '40000000-0000-0000-0000-000000005001', 'Contratos', 1),
  ('40000000-0000-0000-0000-00000000ca02', '40000000-0000-0000-0000-000000005002', 'Contratos', 1);

insert into public.atualizacoes (id, empreendimento_id, projeto_id, etapa_id, titulo, publicado)
values
  ('40000000-0000-0000-0000-00000000d0a1', '40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-000000005001', '40000000-0000-0000-0000-00000000e0a1', 'Atualização A publicada', true),
  ('40000000-0000-0000-0000-00000000d0a2', '40000000-0000-0000-0000-00000000a001', null, null, 'Atualização A rascunho', false),
  ('40000000-0000-0000-0000-00000000d0b1', '40000000-0000-0000-0000-00000000a002', null, null, 'Atualização B publicada', true);

insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho)
values
  ('40000000-0000-0000-0000-00000000d0a1', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a1/etapa4a-teste-f1.jpg', 'image/jpeg', 1000),
  ('40000000-0000-0000-0000-00000000d0a2', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a2/etapa4a-teste-f1.jpg', 'image/jpeg', 1000),
  ('40000000-0000-0000-0000-00000000d0b1', 'atualizacoes/40000000-0000-0000-0000-00000000a002/40000000-0000-0000-0000-00000000d0b1/etapa4a-teste-f1.jpg', 'image/jpeg', 1000);

insert into public.obras (id, empreendimento_id, nome)
values
  ('40000000-0000-0000-0000-00000000b0a1', '40000000-0000-0000-0000-00000000a001', 'Obra A1 Teste'),
  ('40000000-0000-0000-0000-00000000b0a2', '40000000-0000-0000-0000-00000000a001', 'Obra A2 Teste'),
  ('40000000-0000-0000-0000-00000000b0b1', '40000000-0000-0000-0000-00000000a002', 'Obra B1 Teste');

insert into public.obra_empreiteiros (obra_id, profile_id)
values ('40000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000004e1');

insert into public.relatos_obra (id, obra_id, autor_id, texto, status, motivo_devolucao, revisado_por, revisado_em)
values
  ('40000000-0000-0000-0000-00000000c0a1', '40000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000004e1',
   'Relato A1 aprovado', 'aprovado', null, '00000000-0000-0000-0000-0000000004b1', now()),
  ('40000000-0000-0000-0000-00000000c0a2', '40000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000004e1',
   'Relato A1 pendente', 'pendente', null, null, null),
  ('40000000-0000-0000-0000-00000000c0a3', '40000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000004e1',
   'Relato A1 devolvido', 'devolvido', 'Faltou foto', '00000000-0000-0000-0000-0000000004b1', now()),
  ('40000000-0000-0000-0000-00000000c0b1', '40000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000004e1',
   'Relato B1 aprovado', 'aprovado', null, '00000000-0000-0000-0000-0000000004b1', now());

insert into public.relato_fotos (relato_id, storage_path, mime, tamanho)
values
  ('40000000-0000-0000-0000-00000000c0a1', 'relatos/40000000-0000-0000-0000-00000000b0a1/40000000-0000-0000-0000-00000000c0a1/etapa4a-teste-f1.jpg', 'image/jpeg', 1000),
  ('40000000-0000-0000-0000-00000000c0a2', 'relatos/40000000-0000-0000-0000-00000000b0a1/40000000-0000-0000-0000-00000000c0a2/etapa4a-teste-f1.jpg', 'image/jpeg', 1000),
  ('40000000-0000-0000-0000-00000000c0b1', 'relatos/40000000-0000-0000-0000-00000000b0b1/40000000-0000-0000-0000-00000000c0b1/etapa4a-teste-f1.jpg', 'image/jpeg', 1000);

insert into storage.objects (bucket_id, name)
values
  ('obras', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a1/etapa4a-teste-f1.jpg'),
  ('obras', 'relatos/40000000-0000-0000-0000-00000000b0a1/40000000-0000-0000-0000-00000000c0a1/etapa4a-teste-f1.jpg'),
  ('documentos', '40000000-0000-0000-0000-00000000a001/etapa4a-teste.pdf');

-- Estrutura (como postgres): triggers, constraints diferíveis, grants das RPCs e Storage.
do $$
declare
  v_tabela text;
  v_nome text;
begin
  foreach v_tabela in array array['empreendimento_clientes', 'projetos', 'projeto_etapas', 'projeto_categorias_documento', 'atualizacoes', 'documentos'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || v_tabela)::regclass and tgname = v_tabela || '_validar_vinculos_portal' and not tgisinternal) then
      raise exception 'FALHA: falta a trigger de vínculos em %', v_tabela;
    end if;
  end loop;

  foreach v_tabela in array array['modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento', 'projeto_etapas', 'projeto_categorias_documento', 'atualizacoes', 'atualizacao_fotos'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || v_tabela)::regclass and tgname = v_tabela || '_registrar_auditoria' and not tgisinternal) then
      raise exception 'FALHA: falta a trigger de auditoria em %', v_tabela;
    end if;
  end loop;

  foreach v_nome in array array['modelo_etapas_itens_modelo_id_ordem_key', 'modelo_categorias_documento_modelo_id_nome_key',
                                'projeto_categorias_documento_projeto_id_nome_key', 'projeto_etapas_projeto_ordem_key'] loop
    if not exists (select 1 from pg_constraint where conname = v_nome and contype = 'u' and condeferrable and condeferred) then
      raise exception 'FALHA: a constraint % deveria ser DEFERRABLE INITIALLY DEFERRED', v_nome;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.salvar_modelo_portal(uuid,text,text,boolean,jsonb,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.salvar_etapas_projeto_portal(uuid,uuid,jsonb,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.validar_lista_portal(jsonb,boolean,boolean)', 'execute') then
    raise exception 'FALHA: anon executa RPC do portal';
  end if;
  if not has_function_privilege('authenticated', 'public.salvar_modelo_portal(uuid,text,text,boolean,jsonb,jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.salvar_etapas_projeto_portal(uuid,uuid,jsonb,jsonb)', 'execute') then
    raise exception 'FALHA: authenticated deveria executar as RPCs do portal';
  end if;
  if has_function_privilege('anon', 'public.validar_vinculos_portal()', 'execute')
    or has_function_privilege('authenticated', 'public.validar_vinculos_portal()', 'execute') then
    raise exception 'FALHA: a função da trigger de vínculos não pode ser executável diretamente';
  end if;
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('salvar_modelo_portal', 'salvar_etapas_projeto_portal', 'validar_lista_portal')
      and (prosecdef or not coalesce(proconfig, array[]::text[]) @> array['search_path=""'])
  ) then
    raise exception 'FALHA: as funções do portal devem ser SECURITY INVOKER com search_path vazio';
  end if;
  -- Etapa 8: a trigger de vínculos virou definer, porque precisa enxergar linhas de outro módulo.
  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'validar_vinculos_portal'
      and coalesce(proconfig, array[]::text[]) @> array['search_path=""']
  ) then
    raise exception 'FALHA: a trigger de vínculos deve ter search_path vazio';
  end if;

  -- Storage: nada de envio/atualização/exclusão direta nos buckets documentos e obras.
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd <> 'SELECT'
      and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ '''(obras|documentos)'''
  ) then
    raise exception 'FALHA: ainda há política de escrita direta nos buckets documentos/obras';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'obras:%')
    or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'documentos:%') then
    raise exception 'FALHA: a leitura da equipe nos buckets documentos/obras deveria continuar';
  end if;
  -- A Etapa 5 fechou também a escrita direta no bucket fornecedores; resta só a leitura da equipe.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'fornecedores:%') then
    raise exception 'FALHA: a leitura da equipe no bucket fornecedores deveria continuar';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Anon: nenhuma tabela do andamento nem as RPCs.
-- ---------------------------------------------------------------------------
set local role anon;
do $$
declare
  v_tabela text;
  v_conta bigint;
  v_negou boolean;
begin
  foreach v_tabela in array public.t4a_tabelas() loop
    v_negou := false;
    begin
      execute format('select count(*) from public.%I', v_tabela) into v_conta;
    exception when insufficient_privilege then
      v_negou := true;
    end;
    if not v_negou then
      raise exception 'FALHA: anon conseguiu consultar %', v_tabela;
    end if;
  end loop;

  v_negou := false;
  begin
    perform public.salvar_modelo_portal(null, 'Anon', null, true, '[]'::jsonb, '[]'::jsonb);
  exception when insufficient_privilege then
    v_negou := true;
  end;
  if not v_negou then
    raise exception 'FALHA: anon executou salvar_modelo_portal';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Cliente A: lê só o empreendimento A, só publicado, só relato aprovado; nunca escreve.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004c1","role":"authenticated"}';
do $$
begin
  perform public.t4a_exige_conta('select count(*) from public.empreendimentos', 1, 'cliente A deveria ver 1 empreendimento');
  perform public.t4a_exige_conta('select count(*) from public.projetos', 1, 'cliente A deveria ver 1 projeto');
  perform public.t4a_exige_conta('select count(*) from public.projeto_etapas', 2, 'cliente A deveria ver as 2 etapas do projeto');
  perform public.t4a_exige_conta('select count(*) from public.projeto_categorias_documento', 1, 'cliente A deveria ver 1 categoria');
  perform public.t4a_exige_conta('select count(*) from public.atualizacoes', 1, 'cliente A deveria ver só a atualização publicada');
  perform public.t4a_exige_conta('select count(*) from public.atualizacao_fotos', 1, 'cliente A deveria ver só a foto da atualização publicada');
  perform public.t4a_exige_conta('select count(*) from public.obras', 2, 'cliente A deveria ver as 2 obras do empreendimento');
  perform public.t4a_exige_conta('select count(*) from public.relatos_obra', 1, 'cliente A deveria ver só o relato aprovado');
  perform public.t4a_exige_conta('select count(*) from public.relato_fotos', 1, 'cliente A deveria ver só a foto do relato aprovado');
  perform public.t4a_exige_conta('select count(*) from public.empreendimento_clientes', 1, 'cliente A deveria ver só o próprio vínculo');
  perform public.t4a_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '40000000-0000-0000-0000-00000000a002'$q$, 0, 'cliente A viu projeto do B');
  perform public.t4a_exige_conta($q$select count(*) from public.atualizacoes where titulo like '%rascunho%' or empreendimento_id = '40000000-0000-0000-0000-00000000a002'$q$, 0, 'cliente A viu rascunho ou atualização do B');
  perform public.t4a_exige_vazio(array['modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento'], 'cliente A');

  perform public.t4a_exige_negado($q$insert into public.projetos (empreendimento_id, nome) values ('40000000-0000-0000-0000-00000000a001', 'Intruso')$q$, 'cliente criou projeto');
  perform public.t4a_exige_negado($q$update public.projetos set nome = 'Intruso' where id = '40000000-0000-0000-0000-000000005001'$q$, 'cliente editou projeto');
  perform public.t4a_exige_negado($q$delete from public.projetos where id = '40000000-0000-0000-0000-000000005001'$q$, 'cliente apagou projeto');
  perform public.t4a_exige_negado($q$update public.projeto_etapas set concluida_em = current_date where id = '40000000-0000-0000-0000-00000000e0a1'$q$, 'cliente concluiu etapa');
  perform public.t4a_exige_negado($q$insert into public.atualizacoes (empreendimento_id, titulo, publicado) values ('40000000-0000-0000-0000-00000000a001', 'Intruso', true)$q$, 'cliente criou atualização');
  perform public.t4a_exige_negado($q$update public.atualizacoes set publicado = false where id = '40000000-0000-0000-0000-00000000d0a1'$q$, 'cliente despublicou atualização');
  perform public.t4a_exige_negado($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho) values ('40000000-0000-0000-0000-00000000d0a1', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a1/etapa4a-intruso.jpg', 'image/jpeg', 1)$q$, 'cliente inseriu foto');
  perform public.t4a_exige_negado($q$insert into public.empreendimento_clientes (empreendimento_id, profile_id) values ('40000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000004c1')$q$, 'cliente A se vinculou ao B');
  perform public.t4a_exige_negado($q$delete from public.empreendimento_clientes where profile_id = '00000000-0000-0000-0000-0000000004c1'$q$, 'cliente apagou o próprio vínculo');
  perform public.t4a_exige_negado($q$insert into public.modelos_etapas (nome) values ('Intruso')$q$, 'cliente criou modelo');
  perform public.t4a_exige_negado($q$update public.empreendimentos set situacao = 'arquivado'$q$, 'cliente editou empreendimento');
  perform public.t4a_exige_negado($q$select public.salvar_modelo_portal(null, 'Intruso', null, true, '[]'::jsonb, '[]'::jsonb)$q$, 'cliente executou salvar_modelo_portal');
  perform public.t4a_exige_negado($q$select public.salvar_etapas_projeto_portal('40000000-0000-0000-0000-000000005001', null, '[]'::jsonb, '[]'::jsonb)$q$, 'cliente executou salvar_etapas_projeto_portal');
  perform public.t4a_exige_negado($q$select public.criar_projeto_de_modelo('40000000-0000-0000-0000-00000000a001', (select id from public.modelos_etapas limit 1), 'Intruso')$q$, 'cliente criou projeto por RPC');

  perform public.t4a_exige_conta($q$select count(*) from storage.objects where bucket_id in ('obras', 'documentos')$q$, 0, 'cliente A não lê objetos dos buckets privados');
  perform public.t4a_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a1/intruso.jpg')$q$, 'cliente enviou ao bucket obras');
  perform public.t4a_exige_negado($q$insert into storage.objects (bucket_id, name) values ('documentos', '40000000-0000-0000-0000-00000000a001/intruso.pdf')$q$, 'cliente enviou ao bucket documentos');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Cliente B: simétrico, nunca vê o A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004c2","role":"authenticated"}';
do $$
begin
  perform public.t4a_exige_conta('select count(*) from public.projetos', 1, 'cliente B deveria ver 1 projeto');
  perform public.t4a_exige_conta('select count(*) from public.projeto_etapas', 1, 'cliente B deveria ver 1 etapa');
  perform public.t4a_exige_conta('select count(*) from public.atualizacoes', 1, 'cliente B deveria ver 1 atualização');
  perform public.t4a_exige_conta('select count(*) from public.atualizacao_fotos', 1, 'cliente B deveria ver 1 foto');
  perform public.t4a_exige_conta('select count(*) from public.obras', 1, 'cliente B deveria ver 1 obra');
  perform public.t4a_exige_conta('select count(*) from public.relatos_obra', 1, 'cliente B deveria ver 1 relato');
  perform public.t4a_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '40000000-0000-0000-0000-00000000a001'$q$, 0, 'cliente B viu projeto do A');
  perform public.t4a_exige_conta($q$select count(*) from public.obras where empreendimento_id = '40000000-0000-0000-0000-00000000a001'$q$, 0, 'cliente B viu obra do A');
  perform public.t4a_exige_vazio(array['modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento'], 'cliente B');
  perform public.t4a_exige_negado($q$update public.atualizacoes set titulo = 'Intruso' where id = '40000000-0000-0000-0000-00000000d0a1'$q$, 'cliente B editou atualização do A');
  perform public.t4a_exige_negado($q$insert into public.empreendimento_clientes (empreendimento_id, profile_id) values ('40000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000004c2')$q$, 'cliente B se vinculou ao A');
  perform public.t4a_exige_conta($q$select count(*) from storage.objects where bucket_id in ('obras', 'documentos')$q$, 0, 'cliente B não lê objetos dos buckets privados');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Cliente inativo: o papel some, então nada é visível nem gravável.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004c4","role":"authenticated"}';
do $$
begin
  perform public.t4a_exige_vazio(public.t4a_tabelas(), 'cliente inativo');
  perform public.t4a_exige_negado($q$update public.atualizacoes set titulo = 'Intruso'$q$, 'cliente inativo editou atualização');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Empreiteiro e fornecedores: nada do andamento de clientes.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004e1","role":"authenticated"}';
do $$
begin
  perform public.t4a_exige_vazio(array['empreendimento_clientes', 'modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento',
                                       'projetos', 'projeto_etapas', 'projeto_categorias_documento', 'atualizacoes', 'atualizacao_fotos'], 'empreiteiro');
  perform public.t4a_exige_conta('select count(*) from public.obras', 1, 'empreiteiro deveria ver só a obra atribuída');
  perform public.t4a_exige_negado($q$update public.projetos set nome = 'Intruso'$q$, 'empreiteiro editou projeto');
  perform public.t4a_exige_negado($q$select public.salvar_modelo_portal(null, 'Intruso', null, true, '[]'::jsonb, '[]'::jsonb)$q$, 'empreiteiro executou salvar_modelo_portal');
  perform public.t4a_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a1/intruso.jpg')$q$, 'empreiteiro enviou foto de atualização');
end $$;
reset role;

do $$
declare
  v_conta text;
begin
  foreach v_conta in array array['00000000-0000-0000-0000-0000000004f1', '00000000-0000-0000-0000-0000000004f2', '00000000-0000-0000-0000-0000000004f3'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_conta), true);
    set local role authenticated;
    perform public.t4a_exige_vazio(public.t4a_tabelas(), 'fornecedor ' || v_conta);
    perform public.t4a_exige_negado($q$insert into public.atualizacoes (empreendimento_id, titulo) values ('40000000-0000-0000-0000-00000000a001', 'Intruso')$q$, 'fornecedor criou atualização ' || v_conta);
    perform public.t4a_exige_negado($q$select public.salvar_modelo_portal(null, 'Intruso', null, true, '[]'::jsonb, '[]'::jsonb)$q$, 'fornecedor executou RPC ' || v_conta);
    reset role;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Equipe: relações cruzadas, RPCs atômicas, cópia independente, Storage e auditoria.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004b1","role":"authenticated"}';
do $$
declare
  v_modelo uuid;
  v_vazio uuid;
  v_copia uuid;
  v_projeto_vazio uuid;
  v_m1 uuid;
  v_m2 uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_cats jsonb;
  v_atu uuid;
  v_doc uuid;
begin
  -- Vínculos e relações cruzadas recusados pelas triggers.
  perform public.t4a_exige_erro($q$insert into public.empreendimento_clientes (empreendimento_id, profile_id) values ('40000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000004b1')$q$, array['23514'], 'vínculo com perfil que não é cliente');
  perform public.t4a_exige_erro($q$update public.empreendimento_clientes set empreendimento_id = '40000000-0000-0000-0000-00000000a001' where profile_id = '00000000-0000-0000-0000-0000000004c2'$q$, array['23514'], 'transferência de vínculo');
  perform public.t4a_exige_erro($q$update public.projetos set etapa_atual_id = '40000000-0000-0000-0000-00000000e0b1' where id = '40000000-0000-0000-0000-000000005001'$q$, array['23514'], 'etapa atual de outro projeto');
  perform public.t4a_exige_erro($q$update public.projetos set empreendimento_id = '40000000-0000-0000-0000-00000000a002' where id = '40000000-0000-0000-0000-000000005001'$q$, array['23514'], 'transferência de projeto');
  perform public.t4a_exige_erro($q$update public.projeto_etapas set projeto_id = '40000000-0000-0000-0000-000000005002' where id = '40000000-0000-0000-0000-00000000e0a1'$q$, array['23514'], 'transferência de etapa');
  perform public.t4a_exige_erro($q$update public.projeto_categorias_documento set projeto_id = '40000000-0000-0000-0000-000000005002' where id = '40000000-0000-0000-0000-00000000ca01'$q$, array['23514'], 'transferência de categoria');
  perform public.t4a_exige_erro($q$insert into public.atualizacoes (empreendimento_id, projeto_id, titulo) values ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-000000005002', 'x')$q$, array['23514'], 'atualização com projeto de outro empreendimento');
  perform public.t4a_exige_erro($q$insert into public.atualizacoes (empreendimento_id, projeto_id, etapa_id, titulo) values ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-000000005001', '40000000-0000-0000-0000-00000000e0b1', 'x')$q$, array['23514'], 'atualização com etapa de outro projeto');
  perform public.t4a_exige_erro($q$insert into public.atualizacoes (empreendimento_id, etapa_id, titulo) values ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-00000000e0a1', 'x')$q$, array['23514'], 'atualização com etapa sem projeto');
  perform public.t4a_exige_erro($q$update public.atualizacoes set empreendimento_id = '40000000-0000-0000-0000-00000000a002' where id = '40000000-0000-0000-0000-00000000d0a1'$q$, array['23514'], 'transferência de atualização');
  perform public.t4a_exige_erro($q$insert into public.documentos (empreendimento_id, projeto_id, titulo, storage_path, mime, tamanho) values ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-000000005002', 'x', '40000000-0000-0000-0000-00000000a001/x1.pdf', 'application/pdf', 1)$q$, array['23514'], 'documento com projeto de outro empreendimento');
  perform public.t4a_exige_erro($q$insert into public.documentos (empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho) values ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-000000005001', '40000000-0000-0000-0000-00000000ca02', 'x', '40000000-0000-0000-0000-00000000a001/x2.pdf', 'application/pdf', 1)$q$, array['23514'], 'documento com categoria de outro projeto');
  perform public.t4a_exige_erro($q$insert into public.documentos (empreendimento_id, categoria_id, titulo, storage_path, mime, tamanho) values ('40000000-0000-0000-0000-00000000a001', '40000000-0000-0000-0000-00000000ca01', 'x', '40000000-0000-0000-0000-00000000a001/x3.pdf', 'application/pdf', 1)$q$, array['23514'], 'documento com categoria sem projeto');

  -- salvar_modelo_portal: cria, reordena na mesma chamada e é tudo ou nada.
  v_modelo := public.salvar_modelo_portal(null, 'Modelo Etapa4 Teste', 'Descrição', true,
    '[{"nome":"Primeira","ordem":0},{"nome":"Segunda","ordem":1}]'::jsonb, '[{"nome":"Documentos","ordem":0}]'::jsonb);
  select id into v_m1 from public.modelo_etapas_itens where modelo_id = v_modelo and nome = 'Primeira';
  select id into v_m2 from public.modelo_etapas_itens where modelo_id = v_modelo and nome = 'Segunda';
  if v_m1 is null or v_m2 is null then
    raise exception 'FALHA: salvar_modelo_portal não criou as etapas';
  end if;

  perform public.salvar_modelo_portal(v_modelo, 'Modelo Etapa4 Teste', 'Descrição', true,
    jsonb_build_array(jsonb_build_object('id', v_m1, 'nome', 'Primeira', 'ordem', 1), jsonb_build_object('id', v_m2, 'nome', 'Segunda', 'ordem', 0)),
    '[{"nome":"Documentos","ordem":0}]'::jsonb);
  if (select ordem from public.modelo_etapas_itens where id = v_m1) <> 1 or (select ordem from public.modelo_etapas_itens where id = v_m2) <> 0 then
    raise exception 'FALHA: a troca de ordens (constraint diferida) não foi aplicada preservando os ids';
  end if;

  perform public.t4a_exige_erro(format($q$select public.salvar_modelo_portal(%L, 'Nome Que Não Deve Ficar', null, true, '[{"nome":"Xx","ordem":0}]'::jsonb, '[{"nome":"Dup","ordem":0},{"nome":"Dup","ordem":1}]'::jsonb)$q$, v_modelo), array['22023'], 'categorias duplicadas');
  perform public.t4a_exige_erro(format($q$select public.salvar_modelo_portal(%L, 'Nome Que Não Deve Ficar', null, true, '[{"id":"40000000-0000-0000-0000-00000000e0a1","nome":"Alheia","ordem":0}]'::jsonb, '[]'::jsonb)$q$, v_modelo), array['23514'], 'id de etapa de outro pai');
  if (select nome from public.modelos_etapas where id = v_modelo) <> 'Modelo Etapa4 Teste'
    or (select count(*) from public.modelo_etapas_itens where modelo_id = v_modelo) <> 2 then
    raise exception 'FALHA: salvar_modelo_portal deixou alteração parcial após erro';
  end if;
  perform public.t4a_exige_erro(format($q$select public.salvar_modelo_portal(%L, 'Modelo X', null, true, '[{"nome":"Aa","ordem":0},{"nome":"Bb","ordem":0}]'::jsonb, '[]'::jsonb)$q$, v_modelo), array['22023'], 'ordens duplicadas');
  perform public.t4a_exige_erro($q$select public.salvar_modelo_portal(null, 'Modelo X', null, true, '[{"nome":"Aa","ordem":-1}]'::jsonb, '[]'::jsonb)$q$, array['22023'], 'ordem negativa');
  perform public.t4a_exige_erro($q$select public.salvar_modelo_portal(null, 'Modelo X', null, true, '{"nome":"Aa"}'::jsonb, '[]'::jsonb)$q$, array['22023'], 'lista que não é array');
  perform public.t4a_exige_erro($q$select public.salvar_modelo_portal(null, 'Modelo X', null, true, '[{"nome":"Aa","ordem":0,"concluidaEm":"2026-10-01"}]'::jsonb, '[]'::jsonb)$q$, array['22023'], 'concluidaEm em modelo');

  -- Cópia independente: o projeto copia o modelo e não acompanha edições posteriores.
  v_copia := public.criar_projeto_de_modelo('40000000-0000-0000-0000-00000000a001', v_modelo, 'Projeto Cópia Etapa4');
  if (select count(*) from public.projeto_etapas where projeto_id = v_copia) <> 2
    or (select count(*) from public.projeto_categorias_documento where projeto_id = v_copia) <> 1 then
    raise exception 'FALHA: criar_projeto_de_modelo não copiou etapas e categorias';
  end if;
  if (select e.ordem from public.projetos p join public.projeto_etapas e on e.id = p.etapa_atual_id where p.id = v_copia)
    <> (select min(ordem) from public.projeto_etapas where projeto_id = v_copia) then
    raise exception 'FALHA: a etapa atual inicial deveria ser a primeira por ordem';
  end if;
  perform public.salvar_modelo_portal(v_modelo, 'Modelo Etapa4 Teste', null, true,
    jsonb_build_array(jsonb_build_object('id', v_m1, 'nome', 'Mudou', 'ordem', 0)), '[]'::jsonb);
  if (select count(*) from public.projeto_etapas where projeto_id = v_copia) <> 2
    or exists (select 1 from public.projeto_etapas where projeto_id = v_copia and nome = 'Mudou')
    or (select count(*) from public.projeto_categorias_documento where projeto_id = v_copia) <> 1 then
    raise exception 'FALHA: editar o modelo alterou um projeto já criado';
  end if;

  -- Modelo inativo não gera projeto; modelo sem etapas gera projeto sem etapa atual.
  perform public.salvar_modelo_portal(v_modelo, 'Modelo Etapa4 Teste', null, false, '[]'::jsonb, '[]'::jsonb);
  perform public.t4a_exige_erro(format($q$select public.criar_projeto_de_modelo('40000000-0000-0000-0000-00000000a001', %L, 'Projeto Inativo')$q$, v_modelo), array['23514'], 'projeto de modelo inativo');
  v_vazio := public.salvar_modelo_portal(null, 'Modelo Vazio Etapa4 Teste', null, true, '[]'::jsonb, '[]'::jsonb);
  v_projeto_vazio := public.criar_projeto_de_modelo('40000000-0000-0000-0000-00000000a001', v_vazio, 'Projeto Vazio Etapa4');
  if (select etapa_atual_id from public.projetos where id = v_projeto_vazio) is not null then
    raise exception 'FALHA: projeto sem etapas não deveria ter etapa atual';
  end if;
  perform public.salvar_etapas_projeto_portal(v_projeto_vazio, null, '[]'::jsonb, '[]'::jsonb);

  -- salvar_etapas_projeto_portal: concluir, reabrir, reordenar, trocar etapa atual.
  select id into v_p1 from public.projeto_etapas where projeto_id = v_copia order by ordem limit 1;
  select id into v_p2 from public.projeto_etapas where projeto_id = v_copia order by ordem desc limit 1;
  select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ordem', ordem) order by ordem) into v_cats
  from public.projeto_categorias_documento where projeto_id = v_copia;

  perform public.salvar_etapas_projeto_portal(v_copia, v_p1,
    jsonb_build_array(jsonb_build_object('id', v_p1, 'nome', 'Etapa 1', 'ordem', 0, 'concluidaEm', '2026-10-01'), jsonb_build_object('id', v_p2, 'nome', 'Etapa 2', 'ordem', 1)), v_cats);
  if (select concluida_em from public.projeto_etapas where id = v_p1) <> date '2026-10-01'
    or (select etapa_atual_id from public.projetos where id = v_copia) <> v_p1 then
    raise exception 'FALHA: concluir a etapa não deveria avançar a etapa atual';
  end if;
  perform public.salvar_etapas_projeto_portal(v_copia, v_p1,
    jsonb_build_array(jsonb_build_object('id', v_p1, 'nome', 'Etapa 1', 'ordem', 0), jsonb_build_object('id', v_p2, 'nome', 'Etapa 2', 'ordem', 1)), v_cats);
  if (select concluida_em from public.projeto_etapas where id = v_p1) is distinct from date '2026-10-01' then
    raise exception 'FALHA: concluidaEm ausente deveria manter a conclusão';
  end if;
  perform public.salvar_etapas_projeto_portal(v_copia, v_p1,
    jsonb_build_array(jsonb_build_object('id', v_p1, 'nome', 'Etapa 1', 'ordem', 1, 'concluidaEm', null), jsonb_build_object('id', v_p2, 'nome', 'Etapa 2', 'ordem', 0)), v_cats);
  if (select concluida_em from public.projeto_etapas where id = v_p1) is not null
    or (select ordem from public.projeto_etapas where id = v_p1) <> 1 or (select ordem from public.projeto_etapas where id = v_p2) <> 0 then
    raise exception 'FALHA: reabrir e reordenar na mesma chamada não foi aplicado';
  end if;

  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal(%L, null, jsonb_build_array(jsonb_build_object('id', %L::uuid, 'nome', 'E2', 'ordem', 0)), %L::jsonb)$q$, v_copia, v_p2, v_cats), array['23514'], 'remover a etapa atual sem substituta');
  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal(%L, %L, jsonb_build_array(jsonb_build_object('id', %L::uuid, 'nome', 'E2', 'ordem', 0)), %L::jsonb)$q$, v_copia, v_p1, v_p2, v_cats), array['23514'], 'etapa atual fora da lista');
  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal(%L, %L, jsonb_build_array(jsonb_build_object('id', %L::uuid, 'nome', 'E1', 'ordem', 0), jsonb_build_object('id', '40000000-0000-0000-0000-00000000e0a1', 'nome', 'Alheia', 'ordem', 1)), %L::jsonb)$q$, v_copia, v_p1, v_p1, v_cats), array['23514'], 'id de etapa de outro projeto');
  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal(%L, %L, jsonb_build_array(jsonb_build_object('id', %L::uuid, 'nome', 'E1', 'ordem', 0, 'concluidaEm', '2026-02-30')), %L::jsonb)$q$, v_copia, v_p1, v_p1, v_cats), array['22007', '22008', '22023'], 'data de conclusão inexistente');
  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal('40000000-0000-0000-0000-0000000000ff', null, '[]'::jsonb, '[]'::jsonb)$q$), array['P0002'], 'projeto inexistente');
  if (select count(*) from public.projeto_etapas where projeto_id = v_copia) <> 2 then
    raise exception 'FALHA: erro nas RPCs deixou alteração parcial';
  end if;

  perform public.salvar_etapas_projeto_portal(v_copia, v_p2,
    jsonb_build_array(jsonb_build_object('id', v_p2, 'nome', 'Etapa 2', 'ordem', 0)), v_cats);
  if (select etapa_atual_id from public.projetos where id = v_copia) <> v_p2
    or (select count(*) from public.projeto_etapas where projeto_id = v_copia) <> 1 then
    raise exception 'FALHA: remover a etapa atual escolhendo substituta na mesma operação';
  end if;
  perform public.salvar_etapas_projeto_portal(v_copia, v_p2,
    jsonb_build_array(jsonb_build_object('id', v_p2, 'nome', 'Etapa 2', 'ordem', 0), jsonb_build_object('nome', 'Nova', 'ordem', 1)), v_cats);
  if (select count(*) from public.projeto_etapas where projeto_id = v_copia) <> 2 then
    raise exception 'FALHA: etapa nova sem id não foi criada';
  end if;

  -- Etapa citada por atualização e categoria citada por documento não saem.
  insert into public.atualizacoes (empreendimento_id, projeto_id, etapa_id, titulo)
  values ('40000000-0000-0000-0000-00000000a001', v_copia, v_p2, 'Atualização que cita etapa') returning id into v_atu;
  insert into public.documentos (empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho)
  values ('40000000-0000-0000-0000-00000000a001', v_copia, (v_cats->0->>'id')::uuid, 'Documento que cita categoria', '40000000-0000-0000-0000-00000000a001/etapa4a-cita.pdf', 'application/pdf', 1)
  returning id into v_doc;
  -- Reclassificação entre projetos do mesmo empreendimento (etapa/categoria acompanham o projeto novo).
  perform public.t4a_exige_erro(format($q$update public.documentos set projeto_id = '40000000-0000-0000-0000-000000005001' where id = %L$q$, v_doc), array['23514'], 'documento muda de projeto mantendo categoria do antigo');
  perform public.t4a_exige_erro(format($q$update public.documentos set projeto_id = '40000000-0000-0000-0000-000000005002', categoria_id = null where id = %L$q$, v_doc), array['23514'], 'documento muda para projeto de outro empreendimento');
  update public.documentos set projeto_id = '40000000-0000-0000-0000-000000005001', categoria_id = '40000000-0000-0000-0000-00000000ca01' where id = v_doc;
  if not exists (select 1 from public.documentos where id = v_doc and projeto_id = '40000000-0000-0000-0000-000000005001' and categoria_id = '40000000-0000-0000-0000-00000000ca01') then
    raise exception 'FALHA: documento não foi reclassificado para outro projeto do mesmo empreendimento';
  end if;
  update public.documentos set projeto_id = v_copia, categoria_id = (v_cats->0->>'id')::uuid where id = v_doc;
  perform public.t4a_exige_erro(format($q$update public.atualizacoes set projeto_id = '40000000-0000-0000-0000-000000005001' where id = %L$q$, v_atu), array['23514'], 'atualização muda de projeto mantendo etapa do antigo');
  update public.atualizacoes set projeto_id = '40000000-0000-0000-0000-000000005001', etapa_id = '40000000-0000-0000-0000-00000000e0a2' where id = v_atu;
  update public.atualizacoes set projeto_id = v_copia, etapa_id = v_p2 where id = v_atu;
  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal(%L, null, '[]'::jsonb, %L::jsonb)$q$, v_copia, v_cats), array['23503'], 'remover etapa citada por atualização');
  perform public.t4a_exige_erro(format($q$select public.salvar_etapas_projeto_portal(%L, %L, (select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ordem', ordem)) from public.projeto_etapas where projeto_id = %L), '[]'::jsonb)$q$, v_copia, v_p2, v_copia), array['23503'], 'remover categoria citada por documento');

  -- Exclusão do projeto: atualização e documento ficam, com projeto/etapa/categoria nulos.
  perform public.t4a_exige_linhas(format($q$delete from public.projetos where id = %L$q$, v_copia), 1, 'equipe deveria apagar o projeto');
  if not exists (select 1 from public.atualizacoes where id = v_atu and projeto_id is null and etapa_id is null)
    or not exists (select 1 from public.documentos where id = v_doc and projeto_id is null and categoria_id is null) then
    raise exception 'FALHA: ON DELETE SET NULL do projeto deveria zerar projeto/etapa/categoria sem a trigger bloquear';
  end if;

  -- Fotos: a equipe grava e ordena; o cliente só vê depois (ver acima).
  perform public.t4a_exige_linhas($q$insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho, ordem) values ('40000000-0000-0000-0000-00000000d0a2', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a2/etapa4a-equipe.jpg', 'image/jpeg', 100, 1)$q$, 1, 'equipe deveria inserir foto');
  perform public.t4a_exige_linhas($q$update public.atualizacao_fotos set ordem = 5 where storage_path like '%etapa4a-equipe.jpg'$q$, 1, 'equipe deveria reordenar foto');

  -- Vínculo removido revoga a leitura imediatamente (conferido na sequência).
  perform public.t4a_exige_linhas($q$delete from public.empreendimento_clientes where profile_id = '00000000-0000-0000-0000-0000000004c3'$q$, 1, 'equipe deveria desvincular cliente');

  -- Storage: equipe lê, mas não envia nem atualiza direto; só pela URL assinada do servidor.
  perform public.t4a_exige_conta($q$select count(*) from storage.objects where bucket_id in ('obras', 'documentos') and name like '%etapa4a-teste%'$q$, 3, 'equipe deveria ler os objetos dos buckets');
  perform public.t4a_exige_negado($q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/40000000-0000-0000-0000-00000000a001/40000000-0000-0000-0000-00000000d0a1/direto.jpg')$q$, 'equipe enviou direto ao bucket obras');
  perform public.t4a_exige_negado($q$insert into storage.objects (bucket_id, name) values ('documentos', '40000000-0000-0000-0000-00000000a001/direto.pdf')$q$, 'equipe enviou direto ao bucket documentos');
  perform public.t4a_exige_negado($q$update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id in ('obras', 'documentos')$q$, 'equipe substituiu objeto de bucket privado');

  perform public.t4a_exige_vazio(array['auditoria'], 'equipe');
end $$;
reset role;

-- Cliente com vínculo removido: perde a leitura na hora.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004c3","role":"authenticated"}';
do $$
begin
  perform public.t4a_exige_vazio(public.t4a_tabelas(), 'cliente com vínculo removido');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Admin: lê a auditoria, com o ator da sessão nas tabelas de andamento.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}';
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['modelos_etapas', 'modelo_etapas_itens', 'modelo_categorias_documento', 'projeto_etapas',
                                  'projeto_categorias_documento', 'atualizacoes', 'atualizacao_fotos'] loop
    if not exists (select 1 from public.auditoria where tabela = v_tabela and ator_id = '00000000-0000-0000-0000-0000000004b1') then
      raise exception 'FALHA: sem auditoria com o ator da equipe em %', v_tabela;
    end if;
  end loop;

  perform public.salvar_modelo_portal(null, 'Modelo Admin Etapa4 Teste', null, true, '[{"nome":"Única","ordem":0}]'::jsonb, '[]'::jsonb);
  if not exists (select 1 from public.auditoria where tabela = 'modelo_etapas_itens' and ator_id = '00000000-0000-0000-0000-0000000004a1') then
    raise exception 'FALHA: a RPC do admin deveria auditar com o ator admin';
  end if;
end $$;
reset role;

select 'OK: todas as verificações da Etapa 4 (andamento) passaram' as resultado;

rollback;
