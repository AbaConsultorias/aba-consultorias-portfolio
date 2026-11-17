-- Testes da Etapa 8, onda 4 — matriz de RLS: clientes, financeiro, fornecedores, profiles e buckets do storage.
-- Conferência independente do contrato (docs/ETAPA-8-CONTRATO.md §6 e §7) e das resoluções do anexo
-- (docs/ETAPA-8-ANEXO-LEVANTAMENTO.md, "Resoluções do coordenador" e Parte D). Foi escrito sem ler as migrations
-- de RLS da onda 4.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo as de RLS da etapa 8, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_rls_clientes_financeiro.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa8_rls_clientes_financeiro.sql)
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina em ROLLBACK. Se alguma
-- verificação falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O banco de produção tem dados reais: toda contagem filtra pelos ids da fixture (prefixo 81000000-) e nenhuma
-- verificação depende de tabela vazia.
--
-- Como a matriz funciona: t8_ve(consulta, total, quem lê, exceções) confere, para CADA conta, quantas linhas
-- da fixture ela enxerga (quem não está na lista enxerga 0); t8_escreve(comando, quem pode, ...) roda o comando
-- como cada conta e exige sucesso só de quem está na lista. "admin" entra nas listas de forma explícita.
--
-- Contas (ids 81000000-0000-0000-0000-0000000000xx):
--   admin (a1); equipe: n0 (e0, sem nada), cl_v (e1, clientes.ver), cl_e (e2, clientes.ver+editar),
--   fi_v (e3, financeiro.ver), fi_e (e4, +editar), fo_v (e5, fornecedores.ver), fo_e (e6, +editar),
--   ob_v (e7, obras.ver), outro (e8, site.* + contatos.* + painel.servidor), inativa (e9, as 22, ativo=false),
--   pendente (ea, as 22, troca de senha pendente);
--   clientes c1 (do empreendimento A), c2 (do B), c3 (sem vínculo); empreiteiros b1, b2; fornecedores f1 (do F1),
--   f2 (do F2), f3 (sem vínculo); mais anon.
-- Dados: empreendimentos A (e01) e B (e02); fornecedores F1, F2, F3; itens a001 (A, F1), a002 (B, F2), a003 (A, sem
--   fornecedor); uma parcela por item (b001..b003); contratos c001 (F1, A) e c002 (F2); documentos de fornecedor d001 (F1)
--   e d002 (F2); objetos de storage nos quatro buckets.

begin;

-- ---------------------------------------------------------------------------
-- Ajudantes da matriz (existem só dentro da transação).
-- ---------------------------------------------------------------------------

create table public.t8_contas (
  chave text primary key,
  id uuid not null,
  ordem int generated always as identity
);

create function public.t8_conta(
  p_chave text, p_id uuid, p_papel public.papel_usuario,
  p_perms text[] default '{}', p_ativo boolean default true, p_trocar boolean default false
)
returns void
language plpgsql
as $$
declare
  v_permissao text;
begin
  insert into auth.users (id, aud, role, email)
  values (p_id, 'authenticated', 'authenticated', 't8-' || p_chave || '-' || p_id || '@example.com');
  insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
  values (p_id, p_papel, 'T8 ' || p_chave, p_ativo, p_trocar);
  insert into public.t8_contas (chave, id) values (p_chave, p_id);
  foreach v_permissao in array p_perms loop
    insert into public.equipe_permissoes (profile_id, permissao) values (p_id, v_permissao);
  end loop;
end;
$$;

-- Roda um comando como a conta (ou anon / servico = secret key) e devolve o que aconteceu, sem estourar.
create function public.t8_roda(
  p_chave text, p_sql text, p_conta boolean default false,
  out estado text, out linhas bigint, out valor bigint, out msg text
)
language plpgsql
as $$
declare
  v_id uuid;
  v_papel text;
begin
  if p_chave = 'anon' then
    v_papel := 'anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  elsif p_chave = 'servico' then
    v_papel := 'service_role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  else
    select c.id into v_id from public.t8_contas c where c.chave = p_chave;
    if v_id is null then
      raise exception 'FALHA: conta de teste % não existe', p_chave;
    end if;
    v_papel := 'authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  end if;
  -- O Supabase recusa DELETE direto em storage.objects sem este aviso; a recusa que importa é a da política.
  perform set_config('storage.allow_delete_query', 'true', true);
  execute format('set local role %I', v_papel);
  begin
    if p_conta then
      execute p_sql into valor;
      linhas := valor;
    else
      execute p_sql;
      get diagnostics linhas = row_count;
    end if;
    estado := '00000';
  exception when others then
    estado := sqlstate;
    msg := sqlerrm;
    linhas := 0;
  end;
  execute 'reset role';
end;
$$;

-- Leitura: cada conta (e anon) enxerga p_total linhas se estiver em p_quem, senão 0; p_outros troca o esperado
-- de uma conta (valor null = não afirmar nada sobre ela).
create function public.t8_ve(p_sql text, p_total bigint, p_quem text[], p_outros jsonb default '{}'::jsonb)
returns void
language plpgsql
as $$
declare
  v_chave text;
  v_esperado bigint;
  v_veio bigint;
  r record;
begin
  for v_chave in select c.chave from public.t8_contas c union all select 'anon' loop
    if p_outros ? v_chave then
      if jsonb_typeof(p_outros -> v_chave) = 'null' then
        continue;
      end if;
      v_esperado := (p_outros ->> v_chave)::bigint;
    elsif v_chave = any (p_quem) then
      v_esperado := p_total;
    else
      v_esperado := 0;
    end if;

    select * into r from public.t8_roda(v_chave, 'select count(*) from (' || p_sql || ') t8_q', true);
    if r.estado = '42501' then
      v_veio := 0;
    elsif r.estado <> '00000' then
      raise exception 'FALHA: leitura por % deu erro % (%) em [%]', v_chave, r.estado, r.msg, left(p_sql, 200);
    else
      v_veio := r.valor;
    end if;

    if v_veio <> v_esperado then
      raise exception 'FALHA: % deveria enxergar % linha(s) em [%] e enxergou %', v_chave, v_esperado, left(p_sql, 200), v_veio;
    end if;
  end loop;
end;
$$;

-- Escrita: só as contas de p_quem conseguem (e afetam p_linhas linhas); as outras são recusadas por erro de
-- permissão/trigger ou não afetam linha nenhuma. p_prep roda como postgres antes de cada tentativa.
-- {u} vira um uuid novo por tentativa; {n} vira o número da conta.
create function public.t8_escreve(
  p_sql text, p_quem text[], p_msg text, p_prep text default null, p_linhas bigint default 1
)
returns void
language plpgsql
as $$
declare
  v_chave text;
  v_u text;
  v_ordem int;
  v_sql text;
  r record;
begin
  for v_chave in select c.chave from public.t8_contas c union all select 'anon' loop
    v_u := gen_random_uuid()::text;
    select c.ordem into v_ordem from public.t8_contas c where c.chave = v_chave;
    v_ordem := coalesce(v_ordem, 99);
    v_sql := replace(replace(p_sql, '{u}', v_u), '{n}', v_ordem::text);
    if p_prep is not null then
      execute replace(replace(p_prep, '{u}', v_u), '{n}', v_ordem::text);
    end if;

    select * into r from public.t8_roda(v_chave, v_sql);
    if v_chave = any (p_quem) then
      if r.estado <> '00000' then
        raise exception 'FALHA: % deveria conseguir (%) e deu erro % (%)', v_chave, p_msg, r.estado, r.msg;
      end if;
      if r.linhas <> p_linhas then
        raise exception 'FALHA: % afetou % linha(s) em (%), esperado %', v_chave, r.linhas, p_msg, p_linhas;
      end if;
    elsif r.estado = '00000' then
      if r.linhas > 0 then
        raise exception 'FALHA: % não deveria conseguir (%) e afetou % linha(s)', v_chave, p_msg, r.linhas;
      end if;
    elsif r.estado <> all (array['42501', '23514', 'P0001', '55000', 'P0002']) then
      raise exception 'FALHA: % foi recusado por motivo inesperado em (%): % (%)', v_chave, p_msg, r.estado, r.msg;
    end if;
  end loop;
end;
$$;

-- Uma conta só: tem que conseguir.
create function public.t8_pode(p_chave text, p_sql text, p_msg text, p_linhas bigint default 1)
returns void
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.t8_roda(p_chave, p_sql);
  if r.estado <> '00000' then
    raise exception 'FALHA: % deveria conseguir (%) e deu erro % (%)', p_chave, p_msg, r.estado, r.msg;
  end if;
  if r.linhas <> p_linhas then
    raise exception 'FALHA: % afetou % linha(s) em (%), esperado %', p_chave, r.linhas, p_msg, p_linhas;
  end if;
end;
$$;

-- Uma conta só: tem que ser recusada.
create function public.t8_nao_pode(p_chave text, p_sql text, p_msg text)
returns void
language plpgsql
as $$
declare
  r record;
begin
  select * into r from public.t8_roda(p_chave, p_sql);
  if r.estado = '00000' then
    if r.linhas > 0 then
      raise exception 'FALHA: % não deveria conseguir (%) e afetou % linha(s)', p_chave, p_msg, r.linhas;
    end if;
  elsif r.estado <> all (array['42501', '23514', 'P0001', '55000', 'P0002']) then
    raise exception 'FALHA: % foi recusado por motivo inesperado em (%): % (%)', p_chave, p_msg, r.estado, r.msg;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture.
-- ---------------------------------------------------------------------------

select public.t8_conta('admin', '81000000-0000-0000-0000-0000000000a1', 'admin');
select public.t8_conta('n0', '81000000-0000-0000-0000-0000000000e0', 'equipe');
select public.t8_conta('cl_v', '81000000-0000-0000-0000-0000000000e1', 'equipe', array['clientes.ver']);
select public.t8_conta('cl_e', '81000000-0000-0000-0000-0000000000e2', 'equipe', array['clientes.ver', 'clientes.editar']);
select public.t8_conta('fi_v', '81000000-0000-0000-0000-0000000000e3', 'equipe', array['financeiro.ver']);
select public.t8_conta('fi_e', '81000000-0000-0000-0000-0000000000e4', 'equipe', array['financeiro.ver', 'financeiro.editar']);
select public.t8_conta('fo_v', '81000000-0000-0000-0000-0000000000e5', 'equipe', array['fornecedores.ver']);
select public.t8_conta('fo_e', '81000000-0000-0000-0000-0000000000e6', 'equipe', array['fornecedores.ver', 'fornecedores.editar']);
select public.t8_conta('ob_v', '81000000-0000-0000-0000-0000000000e7', 'equipe', array['obras.ver']);
select public.t8_conta('outro', '81000000-0000-0000-0000-0000000000e8', 'equipe',
  array['site.ver', 'site.editar', 'contatos.ver', 'contatos.editar', 'painel.servidor']);
select public.t8_conta('inativa', '81000000-0000-0000-0000-0000000000e9', 'equipe', public.catalogo_permissoes(), false, false);
select public.t8_conta('pendente', '81000000-0000-0000-0000-0000000000ea', 'equipe', public.catalogo_permissoes(), true, true);
select public.t8_conta('c1', '81000000-0000-0000-0000-0000000000c1', 'cliente');
select public.t8_conta('c2', '81000000-0000-0000-0000-0000000000c2', 'cliente');
select public.t8_conta('c3', '81000000-0000-0000-0000-0000000000c3', 'cliente');
select public.t8_conta('b1', '81000000-0000-0000-0000-0000000000b1', 'empreiteiro');
select public.t8_conta('b2', '81000000-0000-0000-0000-0000000000b2', 'empreiteiro');
select public.t8_conta('f1', '81000000-0000-0000-0000-0000000000f1', 'fornecedor');
select public.t8_conta('f2', '81000000-0000-0000-0000-0000000000f2', 'fornecedor');
select public.t8_conta('f3', '81000000-0000-0000-0000-0000000000f3', 'fornecedor');

insert into public.empreendimentos (id, nome)
values
  ('81000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste E8c'),
  ('81000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste E8c');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('81000000-0000-0000-0000-000000000e01', '81000000-0000-0000-0000-0000000000c1'),
  ('81000000-0000-0000-0000-000000000e02', '81000000-0000-0000-0000-0000000000c2');

insert into public.fornecedores (id, razao_social, nome_fantasia)
values
  ('81000000-0000-0000-0000-00000000f001', 'Fornecedor 1 Razão Teste E8c', 'Fornecedor 1 Fantasia Teste E8c'),
  ('81000000-0000-0000-0000-00000000f002', 'Fornecedor 2 Razão Teste E8c', null),
  ('81000000-0000-0000-0000-00000000f003', 'Fornecedor 3 Razão Teste E8c', null);

insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
values
  ('81000000-0000-0000-0000-00000000f001', '81000000-0000-0000-0000-0000000000f1'),
  ('81000000-0000-0000-0000-00000000f002', '81000000-0000-0000-0000-0000000000f2');

insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
values
  ('81000000-0000-0000-0000-00000000a001', '81000000-0000-0000-0000-000000000e01', '81000000-0000-0000-0000-00000000f001', 'Item A fornecedor 1', 100000),
  ('81000000-0000-0000-0000-00000000a002', '81000000-0000-0000-0000-000000000e02', '81000000-0000-0000-0000-00000000f002', 'Item B fornecedor 2', 30000),
  ('81000000-0000-0000-0000-00000000a003', '81000000-0000-0000-0000-000000000e01', null, 'Item A sem fornecedor', 20000);

insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos, data_pagamento, valor_pago_centavos)
values
  ('81000000-0000-0000-0000-00000000b001', '81000000-0000-0000-0000-00000000a001', '2027-01-10', 50000, null, 0),
  ('81000000-0000-0000-0000-00000000b002', '81000000-0000-0000-0000-00000000a002', '2027-01-10', 30000, null, 0),
  ('81000000-0000-0000-0000-00000000b003', '81000000-0000-0000-0000-00000000a003', '2027-01-10', 20000, null, 5000);

insert into public.fornecedor_contratos (id, fornecedor_id, empreendimento_id, titulo, storage_path, mime, tamanho)
values
  ('81000000-0000-0000-0000-00000000c001', '81000000-0000-0000-0000-00000000f001', '81000000-0000-0000-0000-000000000e01',
   'Contrato 1', '81000000-0000-0000-0000-00000000f001/contratos/c001.pdf', 'application/pdf', 100),
  ('81000000-0000-0000-0000-00000000c002', '81000000-0000-0000-0000-00000000f002', null,
   'Contrato 2', '81000000-0000-0000-0000-00000000f002/contratos/c002.pdf', 'application/pdf', 100);

insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
values
  ('81000000-0000-0000-0000-00000000d001', '81000000-0000-0000-0000-00000000f001', '81000000-0000-0000-0000-0000000000f1',
   'certidao', 'Certidão 1', '81000000-0000-0000-0000-00000000f001/documentos/d001.pdf', 'application/pdf', 100),
  ('81000000-0000-0000-0000-00000000d002', '81000000-0000-0000-0000-00000000f002', '81000000-0000-0000-0000-0000000000f2',
   'certidao', 'Certidão 2', '81000000-0000-0000-0000-00000000f002/documentos/d002.pdf', 'application/pdf', 100);

insert into public.downloads_log (arquivo_tipo, arquivo_id, profile_id)
values ('fornecedor_documento', '81000000-0000-0000-0000-00000000d001', '81000000-0000-0000-0000-0000000000f1');

-- Um objeto fixture em cada bucket, para provar que a permissão de um bucket não abre os outros.
insert into storage.objects (bucket_id, name)
values
  ('fornecedores', '81000000-0000-0000-0000-00000000f001/contratos/c001.pdf'),
  ('fornecedores', '81000000-0000-0000-0000-00000000f002/documentos/d002.pdf'),
  ('documentos', '81000000-0000-0000-0000-000000000e01/81000000-0000-0000-0000-00000000d0c1.pdf'),
  ('obras', 'relatos/81000000-0000-0000-0000-00000000b0a1/81000000-0000-0000-0000-00000000c0a1/foto.jpg'),
  ('obras', 'atualizacoes/81000000-0000-0000-0000-000000000e01/foto.jpg'),
  ('site-publico', '81000000-0000-0000-0000-site/arquivo.webp');

-- ---------------------------------------------------------------------------
-- Leitura: clientes e vínculos.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.empreendimento_clientes where empreendimento_id::text like '81000000-%'$q$,
  2, array['admin', 'cl_v', 'cl_e'], '{"c1": 1, "c2": 1}');

-- profiles por tipo de conta (R16): cliente com clientes.ver, empreiteiro com obras.ver, fornecedor com
-- fornecedores.ver; admin e equipe só o admin (e cada um a própria linha).
select public.t8_ve(
  $q$select 1 from public.profiles where id::text like '81000000-%' and papel = 'cliente'$q$,
  3, array['admin', 'cl_v', 'cl_e'], '{"c1": 1, "c2": 1, "c3": 1}');
select public.t8_ve(
  $q$select 1 from public.profiles where id::text like '81000000-%' and papel = 'empreiteiro'$q$,
  2, array['admin', 'ob_v'], '{"b1": 1, "b2": 1}');
select public.t8_ve(
  $q$select 1 from public.profiles where id::text like '81000000-%' and papel = 'fornecedor'$q$,
  3, array['admin', 'fo_v', 'fo_e'], '{"f1": 1, "f2": 1, "f3": 1}');
select public.t8_ve(
  $q$select 1 from public.profiles where id::text like '81000000-%' and papel = 'admin'$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 from public.profiles where id::text like '81000000-%' and papel = 'equipe'$q$,
  11, array['admin'],
  '{"n0": 1, "cl_v": 1, "cl_e": 1, "fi_v": 1, "fi_e": 1, "fo_v": 1, "fo_e": 1, "ob_v": 1, "outro": 1, "inativa": 1, "pendente": 1}');
-- A própria linha é sempre legível, qualquer que seja o tipo.
select public.t8_ve(
  $q$select 1 from public.profiles where id::text like '81000000-%'$q$,
  20, array['admin'],
  '{"n0": 1, "cl_v": 4, "cl_e": 4, "fi_v": 1, "fi_e": 1, "fo_v": 4, "fo_e": 4, "ob_v": 3, "outro": 1, "inativa": 1, "pendente": 1, "c1": 1, "c2": 1, "c3": 1, "b1": 1, "b2": 1, "f1": 1, "f2": 1, "f3": 1}');

-- Ninguém escreve em profiles pela sessão (nem o admin: a escrita é da secret key).
select public.t8_escreve(
  $q$update public.profiles set nome = 'T8 trocado' where id = '81000000-0000-0000-0000-0000000000c3'$q$,
  array[]::text[], 'alterar nome de perfil');
select public.t8_escreve(
  $q$update public.profiles set papel = 'admin' where id = '81000000-0000-0000-0000-0000000000e0'$q$,
  array[]::text[], 'promover perfil a admin');
select public.t8_escreve(
  $q$update public.profiles set ativo = false where id = '81000000-0000-0000-0000-0000000000e1'$q$,
  array[]::text[], 'desativar perfil');
select public.t8_escreve(
  $q$delete from public.profiles where id = '81000000-0000-0000-0000-0000000000c3'$q$,
  array[]::text[], 'apagar perfil');

-- ---------------------------------------------------------------------------
-- Leitura: financeiro (itens, parcelas e a view), com os ramos de cliente e de fornecedor intactos.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.itens_financeiros where id::text like '81000000-%'$q$,
  3, array['admin', 'fi_v', 'fi_e'], '{"c1": 2, "c2": 1, "f1": 1, "f2": 1}');
select public.t8_ve(
  $q$select 1 from public.parcelas where id::text like '81000000-%'$q$,
  3, array['admin', 'fi_v', 'fi_e'], '{"c1": 2, "c2": 1, "f1": 1, "f2": 1}');
select public.t8_ve(
  $q$select 1 from public.parcelas_situacao where id::text like '81000000-%'$q$,
  3, array['admin', 'fi_v', 'fi_e'], '{"c1": 2, "c2": 1, "f1": 1, "f2": 1}');

-- ---------------------------------------------------------------------------
-- Leitura: fornecedores, vínculos, contratos e documentos.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.fornecedores where id::text like '81000000-%'$q$,
  3, array['admin', 'fo_v', 'fo_e'], '{"f1": 1, "f2": 1}');
select public.t8_ve(
  $q$select 1 from public.fornecedor_usuarios where profile_id::text like '81000000-%'$q$,
  2, array['admin', 'fo_v', 'fo_e'], '{"f1": 1, "f2": 1}');
select public.t8_ve(
  $q$select 1 from public.fornecedor_contratos where id::text like '81000000-%'$q$,
  2, array['admin', 'fo_v', 'fo_e'], '{"f1": 1, "f2": 1}');
select public.t8_ve(
  $q$select 1 from public.fornecedor_documentos where id::text like '81000000-%'$q$,
  2, array['admin', 'fo_v', 'fo_e'], '{"f1": 1, "f2": 1}');

-- Só o admin lê o log de downloads e a auditoria.
select public.t8_ve(
  $q$select 1 from public.downloads_log where profile_id::text like '81000000-%'$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 from public.auditoria where tabela = 'fornecedores' and acao = 'INSERT' and registro_id::text like '81000000-%'$q$,
  3, array['admin']);

-- ---------------------------------------------------------------------------
-- Leitura: storage por bucket (a escrita nos buckets privados não tem política: nem o admin escreve pela sessão).
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'fornecedores' and name like '81000000-%'$q$,
  2, array['admin', 'fo_v', 'fo_e']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'documentos' and name like '81000000-%'$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'obras' and name like 'relatos/81000000-%'$q$,
  1, array['admin', 'ob_v']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'obras' and name like 'atualizacoes/81000000-%'$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'site-publico' and name like '81000000-%'$q$,
  1, array['admin', 'outro']);

select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('fornecedores', '81000000-0000-0000-0000-00000000f001/documentos/{u}.pdf')$q$,
  array[]::text[], 'enviar arquivo ao bucket fornecedores pela sessão');
select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('documentos', '81000000-0000-0000-0000-000000000e01/{u}.pdf')$q$,
  array[]::text[], 'enviar arquivo ao bucket documentos pela sessão');
select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/81000000-0000-0000-0000-00000000b0a1/{u}.jpg')$q$,
  array[]::text[], 'enviar arquivo ao bucket obras pela sessão');
select public.t8_escreve(
  $q$update storage.objects set name = name || 'x' where bucket_id = 'fornecedores' and name like '81000000-%'$q$,
  array[]::text[], 'renomear objeto de fornecedores');
select public.t8_escreve(
  $q$delete from storage.objects where bucket_id = 'fornecedores' and name like '81000000-%'$q$,
  array[]::text[], 'apagar objeto de fornecedores pela sessão', null, 2);
select public.t8_escreve(
  $q$delete from storage.objects where bucket_id = 'documentos' and name like '81000000-%'$q$,
  array[]::text[], 'apagar objeto de documentos pela sessão');

-- ---------------------------------------------------------------------------
-- Funções de nome: só o nome, por permissão (e os ramos de cliente, fornecedor e o próprio perfil seguem).
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 where public.nome_pessoa('81000000-0000-0000-0000-0000000000c1') is not null$q$,
  1, array['admin', 'cl_v', 'cl_e'], '{"c1": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('81000000-0000-0000-0000-0000000000b1') is not null$q$,
  1, array['admin', 'ob_v'], '{"b1": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('81000000-0000-0000-0000-0000000000f1') is not null$q$,
  1, array['admin', 'fo_v', 'fo_e'], '{"f1": 1}');
-- Nome de admin e de equipe: só para o admin (e para a própria pessoa).
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('81000000-0000-0000-0000-0000000000a1') is not null$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('81000000-0000-0000-0000-0000000000e0') is not null$q$,
  1, array['admin'], '{"n0": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('81000000-0000-0000-0000-0000000000e4') is not null$q$,
  1, array['admin'], '{"fi_e": 1}');

select public.t8_ve(
  $q$select 1 where public.nome_fornecedor('81000000-0000-0000-0000-00000000f001') is not null$q$,
  1, array['admin', 'fo_v', 'fo_e', 'fi_v', 'fi_e'], '{"f1": 1, "c1": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_fornecedor('81000000-0000-0000-0000-00000000f002') is not null$q$,
  1, array['admin', 'fo_v', 'fo_e', 'fi_v', 'fi_e'], '{"f2": 1, "c2": 1}');

-- fornecedores.ver não está entre as permissões que o contrato manda abrir para nome_empreendimento (null = não afirmo).
select public.t8_ve(
  $q$select 1 where public.nome_empreendimento('81000000-0000-0000-0000-000000000e01') is not null$q$,
  1, array['admin', 'cl_v', 'cl_e', 'fi_v', 'fi_e', 'ob_v'], '{"c1": 1, "f1": 1, "fo_v": null, "fo_e": null, "outro": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_empreendimento('81000000-0000-0000-0000-000000000e02') is not null$q$,
  1, array['admin', 'cl_v', 'cl_e', 'fi_v', 'fi_e', 'ob_v'], '{"c2": 1, "f2": 1, "fo_v": null, "fo_e": null, "outro": 1}');

-- ---------------------------------------------------------------------------
-- Escrita: clientes (vínculo com empreendimento) e o trigger validar_vinculos_portal.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.empreendimento_clientes (empreendimento_id, profile_id)
     values ('81000000-0000-0000-0000-000000000e01', '81000000-0000-0000-0000-0000000000c3')$q$,
  array['admin', 'cl_e'], 'vincular cliente a empreendimento',
  $q$delete from public.empreendimento_clientes where profile_id = '81000000-0000-0000-0000-0000000000c3'$q$);
-- O trigger continua recusando vínculo de quem não é cliente, mesmo para quem pode vincular.
select public.t8_escreve(
  $q$insert into public.empreendimento_clientes (empreendimento_id, profile_id)
     values ('81000000-0000-0000-0000-000000000e01', '81000000-0000-0000-0000-0000000000b2')$q$,
  array[]::text[], 'vincular empreiteiro como cliente',
  $q$delete from public.empreendimento_clientes where profile_id = '81000000-0000-0000-0000-0000000000b2'$q$);
select public.t8_escreve(
  $q$update public.empreendimento_clientes set empreendimento_id = empreendimento_id
      where profile_id = '81000000-0000-0000-0000-0000000000c1'$q$,
  array['admin', 'cl_e'], 'atualizar vínculo de cliente');
select public.t8_escreve(
  $q$update public.empreendimento_clientes set empreendimento_id = '81000000-0000-0000-0000-000000000e02'
      where profile_id = '81000000-0000-0000-0000-0000000000c1'$q$,
  array[]::text[], 'transferir vínculo de cliente');
select public.t8_escreve(
  $q$delete from public.empreendimento_clientes where profile_id = '81000000-0000-0000-0000-0000000000c3'$q$,
  array['admin', 'cl_e'], 'desvincular cliente',
  $q$insert into public.empreendimento_clientes (empreendimento_id, profile_id)
     values ('81000000-0000-0000-0000-000000000e01', '81000000-0000-0000-0000-0000000000c3') on conflict do nothing$q$);

-- ---------------------------------------------------------------------------
-- Escrita: financeiro (itens, parcelas e a função de exclusão).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.itens_financeiros (id, empreendimento_id, descricao, valor_contratado_centavos)
     values ('{u}', '81000000-0000-0000-0000-000000000e01', 'T8 item novo', 100)$q$,
  array['admin', 'fi_e'], 'criar item financeiro');
select public.t8_escreve(
  $q$insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
     values ('{u}', '81000000-0000-0000-0000-000000000e01', '81000000-0000-0000-0000-00000000f001', 'T8 item com fornecedor', 100)$q$,
  array['admin', 'fi_e'], 'criar item financeiro com fornecedor');
select public.t8_escreve(
  $q$update public.itens_financeiros set descricao = 'T8 item editado' where id = '81000000-0000-0000-0000-00000000a003'$q$,
  array['admin', 'fi_e'], 'editar item financeiro');
select public.t8_escreve(
  $q$delete from public.itens_financeiros where id = '{u}'$q$,
  array['admin', 'fi_e'], 'apagar item financeiro',
  $q$insert into public.itens_financeiros (id, empreendimento_id, descricao, valor_contratado_centavos)
     values ('{u}', '81000000-0000-0000-0000-000000000e01', 'T8 item descartável', 100)$q$);
select public.t8_escreve(
  $q$select public.excluir_item_financeiro_portal('{u}')$q$,
  array['admin', 'fi_e'], 'excluir item financeiro pela função',
  $q$insert into public.itens_financeiros (id, empreendimento_id, descricao, valor_contratado_centavos)
     values ('{u}', '81000000-0000-0000-0000-000000000e01', 'T8 item da função', 100)$q$);

select public.t8_escreve(
  $q$insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos)
     values ('{u}', '81000000-0000-0000-0000-00000000a003', '2027-03-01', 100)$q$,
  array['admin', 'fi_e'], 'criar parcela');
select public.t8_escreve(
  $q$update public.parcelas set observacao = 'T8 obs' where id = '81000000-0000-0000-0000-00000000b003'$q$,
  array['admin', 'fi_e'], 'editar parcela');
select public.t8_escreve(
  $q$delete from public.parcelas where id = '{u}'$q$,
  array['admin', 'fi_e'], 'apagar parcela',
  $q$insert into public.parcelas (id, item_id, vencimento, valor_previsto_centavos)
     values ('{u}', '81000000-0000-0000-0000-00000000a003', '2027-03-02', 100)$q$);

-- Cliente e fornecedor leem o que é deles mas não escrevem em nada do financeiro (nenhum está nas listas acima);
-- o log de downloads e a auditoria não têm política de escrita para ninguém, nem para o admin.
select public.t8_escreve(
  $q$insert into public.downloads_log (arquivo_tipo, arquivo_id) values ('documento', '{u}')$q$,
  array[]::text[], 'gravar no log de downloads pela sessão');
select public.t8_escreve(
  $q$delete from public.downloads_log where profile_id::text like '81000000-%'$q$,
  array[]::text[], 'apagar o log de downloads');
select public.t8_escreve(
  $q$insert into public.auditoria (tabela, acao) values ('t8', 'INSERT')$q$,
  array[]::text[], 'gravar na auditoria pela sessão');
select public.t8_escreve(
  $q$delete from public.auditoria where registro_id::text like '81000000-%'$q$,
  array[]::text[], 'apagar a auditoria');

-- ---------------------------------------------------------------------------
-- Escrita: fornecedores, vínculos (validar_vinculos_acesso), contratos e documentos.
-- Apagar cadastro, contrato e documento de fornecedor é só do admin (R11 e contrato §3).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.fornecedores (id, razao_social) values ('{u}', 'T8 fornecedor novo {n}')$q$,
  array['admin', 'fo_e'], 'criar fornecedor');
select public.t8_escreve(
  $q$update public.fornecedores set observacao = 'T8 obs' where id = '81000000-0000-0000-0000-00000000f003'$q$,
  array['admin', 'fo_e'], 'editar fornecedor');
select public.t8_escreve(
  $q$delete from public.fornecedores where id = '{u}'$q$,
  array['admin'], 'apagar cadastro de fornecedor',
  $q$insert into public.fornecedores (id, razao_social) values ('{u}', 'T8 fornecedor descartável {n}')$q$);

select public.t8_escreve(
  $q$insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
     values ('81000000-0000-0000-0000-00000000f003', '81000000-0000-0000-0000-0000000000f3')$q$,
  array['admin', 'fo_e'], 'vincular conta de fornecedor',
  $q$delete from public.fornecedor_usuarios where profile_id = '81000000-0000-0000-0000-0000000000f3'$q$);
select public.t8_escreve(
  $q$insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
     values ('81000000-0000-0000-0000-00000000f003', '81000000-0000-0000-0000-0000000000c3')$q$,
  array[]::text[], 'vincular cliente como usuário de fornecedor',
  $q$delete from public.fornecedor_usuarios where profile_id = '81000000-0000-0000-0000-0000000000c3'$q$);
select public.t8_escreve(
  $q$update public.fornecedor_usuarios set fornecedor_id = fornecedor_id
      where profile_id = '81000000-0000-0000-0000-0000000000f2'$q$,
  array['admin', 'fo_e'], 'atualizar vínculo de fornecedor');
select public.t8_escreve(
  $q$delete from public.fornecedor_usuarios where profile_id = '81000000-0000-0000-0000-0000000000f3'$q$,
  array['admin', 'fo_e'], 'desvincular conta de fornecedor',
  $q$insert into public.fornecedor_usuarios (fornecedor_id, profile_id)
     values ('81000000-0000-0000-0000-00000000f003', '81000000-0000-0000-0000-0000000000f3') on conflict do nothing$q$);

select public.t8_escreve(
  $q$insert into public.fornecedor_contratos (id, fornecedor_id, titulo, storage_path, mime, tamanho)
     values ('{u}', '81000000-0000-0000-0000-00000000f001', 'T8 contrato novo',
             '81000000-0000-0000-0000-00000000f001/contratos/{u}.pdf', 'application/pdf', 100)$q$,
  array['admin', 'fo_e'], 'criar contrato de fornecedor');
select public.t8_escreve(
  $q$update public.fornecedor_contratos set titulo = 'T8 contrato editado' where id = '81000000-0000-0000-0000-00000000c002'$q$,
  array['admin', 'fo_e'], 'editar contrato de fornecedor');
select public.t8_escreve(
  $q$delete from public.fornecedor_contratos where id = '{u}'$q$,
  array['admin'], 'apagar contrato de fornecedor',
  $q$insert into public.fornecedor_contratos (id, fornecedor_id, titulo, storage_path, mime, tamanho)
     values ('{u}', '81000000-0000-0000-0000-00000000f001', 'T8 contrato descartável',
             '81000000-0000-0000-0000-00000000f001/contratos/{u}.pdf', 'application/pdf', 100)$q$);

select public.t8_escreve(
  $q$insert into public.fornecedor_documentos (id, fornecedor_id, tipo, titulo, storage_path, mime, tamanho)
     values ('{u}', '81000000-0000-0000-0000-00000000f001', 'certidao', 'T8 documento novo',
             '81000000-0000-0000-0000-00000000f001/documentos/{u}.pdf', 'application/pdf', 100)$q$,
  array['admin', 'fo_e'], 'registrar documento de fornecedor');
select public.t8_escreve(
  $q$update public.fornecedor_documentos set status = 'aprovado' where id = '{u}'$q$,
  array['admin', 'fo_e'], 'aprovar documento de fornecedor',
  $q$insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
     values ('{u}', '81000000-0000-0000-0000-00000000f001', '81000000-0000-0000-0000-0000000000f1', 'certidao', 'T8 a aprovar',
             '81000000-0000-0000-0000-00000000f001/documentos/{u}.pdf', 'application/pdf', 100)$q$);
select public.t8_escreve(
  $q$delete from public.fornecedor_documentos where id = '{u}'$q$,
  array['admin'], 'apagar documento de fornecedor',
  $q$insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, tipo, titulo, storage_path, mime, tamanho)
     values ('{u}', '81000000-0000-0000-0000-00000000f001', '81000000-0000-0000-0000-0000000000f1', 'certidao', 'T8 descartável',
             '81000000-0000-0000-0000-00000000f001/documentos/{u}.pdf', 'application/pdf', 100)$q$);

-- O fornecedor e o cliente não escrevem em nada disso (nenhuma lista acima os inclui). Confere um a um os caminhos
-- mais sensíveis: o fornecedor não aprova o próprio documento e não troca o fornecedor do vínculo.
select public.t8_nao_pode('f1',
  $q$update public.fornecedor_documentos set status = 'aprovado' where id = '81000000-0000-0000-0000-00000000d001'$q$,
  'fornecedor aprovar o próprio documento');
select public.t8_nao_pode('f1',
  $q$update public.fornecedores set observacao = 'T8 f1' where id = '81000000-0000-0000-0000-00000000f001'$q$,
  'fornecedor editar o próprio cadastro');
select public.t8_nao_pode('c1',
  $q$update public.itens_financeiros set descricao = 'T8 c1' where id = '81000000-0000-0000-0000-00000000a001'$q$,
  'cliente editar item financeiro');

-- Depois de toda a matriz, os dados originais da fixture continuam do jeito que estavam.
do $$
begin
  if (select count(*) from public.itens_financeiros where id in (
        '81000000-0000-0000-0000-00000000a001', '81000000-0000-0000-0000-00000000a002', '81000000-0000-0000-0000-00000000a003')) <> 3 then
    raise exception 'FALHA: a matriz apagou item financeiro da fixture';
  end if;
  if (select count(*) from public.fornecedor_documentos where id in (
        '81000000-0000-0000-0000-00000000d001', '81000000-0000-0000-0000-00000000d002')) <> 2 then
    raise exception 'FALHA: a matriz apagou documento de fornecedor da fixture';
  end if;
  if (select status from public.fornecedor_documentos where id = '81000000-0000-0000-0000-00000000d001') <> 'pendente' then
    raise exception 'FALHA: o fornecedor conseguiu aprovar o próprio documento';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'fornecedores' and name like '81000000-%') < 2 then
    raise exception 'FALHA: a matriz apagou objeto do bucket fornecedores';
  end if;
end $$;

select 'OK: clientes, financeiro, fornecedores, profiles e storage da Etapa 8 passaram na matriz de RLS' as resultado;

rollback;
