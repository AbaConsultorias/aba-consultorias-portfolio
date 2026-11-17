-- Testes da Etapa 8, onda 4 — matriz de RLS: empreendimentos, projetos, modelos, atualizações, obras e relatos.
-- Conferência independente do contrato (docs/ETAPA-8-CONTRATO.md §6 e §7) e das resoluções do anexo
-- (docs/ETAPA-8-ANEXO-LEVANTAMENTO.md, "Resoluções do coordenador" e Parte D). Foi escrito sem ler as migrations
-- de RLS da onda 4.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo as de RLS da etapa 8, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_rls_andamento_obras.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa8_rls_andamento_obras.sql)
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina em ROLLBACK. Se alguma
-- verificação falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O banco de produção tem dados reais: toda contagem filtra pelos ids da fixture (prefixo 82000000-) e nenhuma
-- verificação depende de tabela vazia.
--
-- Como a matriz funciona: t8_ve(consulta, total, quem lê, exceções) confere, para CADA conta, quantas linhas
-- da fixture ela enxerga (quem não está na lista enxerga 0); t8_escreve(comando, quem pode, ...) roda o comando
-- como cada conta e exige sucesso só de quem está na lista. "admin" entra nas listas de forma explícita.
--
-- Contas (ids 82000000-0000-0000-0000-0000000000xx):
--   admin (a1); equipe: n0 (e0, sem nada), em_v (e1, empreendimentos.ver), em_e (e2, +editar), at_v (e3, atualizacoes.ver),
--   at_e (e4, +editar), ob_v (e5, obras.ver), ob_e (e6, +editar), ob_ap (e7, obras.ver+aprovar, sem editar),
--   ob_ea (e8, obras.ver+editar+aprovar), dc_v (e9, documentos.ver), sr (eb, empreendimentos.ver+servidor.regras),
--   cl_v (ec, clientes.ver), outro (ee, site.* + contatos.* + painel.servidor), inativa (ef, as 22, ativo=false),
--   pendente (f0, as 22, troca de senha pendente);
--   clientes c1 (do empreendimento A) e c2 (do B); empreiteiros b1 (da obra A1), b2 (da B1) e b3 (livre);
--   fornecedor f1; mais anon.
-- Dados: empreendimentos A (e01) e B (e02); modelo base; projetos pA1, pB1 e pX (vazio); atualizações uA (publicada),
--   uA2 (rascunho) e uB; obras oA1, oA2 e oB1; relatos rA1 (aprovado), rA2 (pendente) e rB1 (aprovado).

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

select public.t8_conta('admin', '82000000-0000-0000-0000-0000000000a1', 'admin');
select public.t8_conta('n0', '82000000-0000-0000-0000-0000000000e0', 'equipe');
select public.t8_conta('em_v', '82000000-0000-0000-0000-0000000000e1', 'equipe', array['empreendimentos.ver']);
select public.t8_conta('em_e', '82000000-0000-0000-0000-0000000000e2', 'equipe', array['empreendimentos.ver', 'empreendimentos.editar']);
select public.t8_conta('at_v', '82000000-0000-0000-0000-0000000000e3', 'equipe', array['atualizacoes.ver']);
select public.t8_conta('at_e', '82000000-0000-0000-0000-0000000000e4', 'equipe', array['atualizacoes.ver', 'atualizacoes.editar']);
select public.t8_conta('ob_v', '82000000-0000-0000-0000-0000000000e5', 'equipe', array['obras.ver']);
select public.t8_conta('ob_e', '82000000-0000-0000-0000-0000000000e6', 'equipe', array['obras.ver', 'obras.editar']);
select public.t8_conta('ob_ap', '82000000-0000-0000-0000-0000000000e7', 'equipe', array['obras.ver', 'obras.aprovar']);
select public.t8_conta('ob_ea', '82000000-0000-0000-0000-0000000000e8', 'equipe', array['obras.ver', 'obras.editar', 'obras.aprovar']);
select public.t8_conta('dc_v', '82000000-0000-0000-0000-0000000000e9', 'equipe', array['documentos.ver']);
select public.t8_conta('sr', '82000000-0000-0000-0000-0000000000eb', 'equipe', array['empreendimentos.ver', 'servidor.regras']);
select public.t8_conta('cl_v', '82000000-0000-0000-0000-0000000000ec', 'equipe', array['clientes.ver']);
select public.t8_conta('outro', '82000000-0000-0000-0000-0000000000ee', 'equipe',
  array['site.ver', 'site.editar', 'contatos.ver', 'contatos.editar', 'painel.servidor']);
select public.t8_conta('inativa', '82000000-0000-0000-0000-0000000000ef', 'equipe', public.catalogo_permissoes(), false, false);
select public.t8_conta('pendente', '82000000-0000-0000-0000-0000000000f0', 'equipe', public.catalogo_permissoes(), true, true);
select public.t8_conta('c1', '82000000-0000-0000-0000-0000000000c1', 'cliente');
select public.t8_conta('c2', '82000000-0000-0000-0000-0000000000c2', 'cliente');
select public.t8_conta('b1', '82000000-0000-0000-0000-0000000000b1', 'empreiteiro');
select public.t8_conta('b2', '82000000-0000-0000-0000-0000000000b2', 'empreiteiro');
select public.t8_conta('b3', '82000000-0000-0000-0000-0000000000b3', 'empreiteiro');
select public.t8_conta('f1', '82000000-0000-0000-0000-0000000000f1', 'fornecedor');

insert into public.empreendimentos (id, nome)
values
  ('82000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste E8a'),
  ('82000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste E8a');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('82000000-0000-0000-0000-000000000e01', '82000000-0000-0000-0000-0000000000c1'),
  ('82000000-0000-0000-0000-000000000e02', '82000000-0000-0000-0000-0000000000c2');

insert into public.modelos_etapas (id, nome, ativo)
values ('82000000-0000-0000-0000-00000000a0d1', 'Modelo base Teste E8a', true);
insert into public.modelo_etapas_itens (id, modelo_id, nome, ordem)
values ('82000000-0000-0000-0000-00000000a0e1', '82000000-0000-0000-0000-00000000a0d1', 'Etapa modelo 1', 1);
insert into public.modelo_categorias_documento (id, modelo_id, nome, ordem)
values ('82000000-0000-0000-0000-00000000a0c1', '82000000-0000-0000-0000-00000000a0d1', 'Categoria modelo 1', 1);

insert into public.projetos (id, empreendimento_id, nome)
values
  ('82000000-0000-0000-0000-00000000a001', '82000000-0000-0000-0000-000000000e01', 'Projeto A1 Teste E8a'),
  ('82000000-0000-0000-0000-00000000a002', '82000000-0000-0000-0000-000000000e02', 'Projeto B1 Teste E8a'),
  ('82000000-0000-0000-0000-00000000a003', '82000000-0000-0000-0000-000000000e01', 'Projeto X Teste E8a');
insert into public.projeto_etapas (id, projeto_id, nome, ordem)
values
  ('82000000-0000-0000-0000-00000000a0a1', '82000000-0000-0000-0000-00000000a001', 'Etapa A1', 1),
  ('82000000-0000-0000-0000-00000000a0a2', '82000000-0000-0000-0000-00000000a002', 'Etapa B1', 1);
insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values
  ('82000000-0000-0000-0000-00000000a0b1', '82000000-0000-0000-0000-00000000a001', 'Categoria A1', 1),
  ('82000000-0000-0000-0000-00000000a0b2', '82000000-0000-0000-0000-00000000a002', 'Categoria B1', 1);

insert into public.atualizacoes (id, empreendimento_id, titulo, publicado)
values
  ('82000000-0000-0000-0000-00000000b001', '82000000-0000-0000-0000-000000000e01', 'Atualização A publicada', true),
  ('82000000-0000-0000-0000-00000000b002', '82000000-0000-0000-0000-000000000e01', 'Atualização A rascunho', false),
  ('82000000-0000-0000-0000-00000000b003', '82000000-0000-0000-0000-000000000e02', 'Atualização B publicada', true);
insert into public.atualizacao_fotos (id, atualizacao_id, storage_path, mime, tamanho)
values
  ('82000000-0000-0000-0000-00000000b0f1', '82000000-0000-0000-0000-00000000b001', 'atualizacoes/82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000b001/f1.jpg', 'image/jpeg', 100),
  ('82000000-0000-0000-0000-00000000b0f2', '82000000-0000-0000-0000-00000000b002', 'atualizacoes/82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000b002/f2.jpg', 'image/jpeg', 100),
  ('82000000-0000-0000-0000-00000000b0f3', '82000000-0000-0000-0000-00000000b003', 'atualizacoes/82000000-0000-0000-0000-000000000e02/82000000-0000-0000-0000-00000000b003/f3.jpg', 'image/jpeg', 100);

insert into public.obras (id, empreendimento_id, nome, percentual, situacao)
values
  ('82000000-0000-0000-0000-00000000c001', '82000000-0000-0000-0000-000000000e01', 'Obra A1 Teste E8a', 10, 'em_andamento'),
  ('82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-000000000e01', 'Obra A2 Teste E8a', 0, 'planejada'),
  ('82000000-0000-0000-0000-00000000c003', '82000000-0000-0000-0000-000000000e02', 'Obra B1 Teste E8a', 20, 'em_andamento');
insert into public.obra_empreiteiros (obra_id, profile_id)
values
  ('82000000-0000-0000-0000-00000000c001', '82000000-0000-0000-0000-0000000000b1'),
  ('82000000-0000-0000-0000-00000000c003', '82000000-0000-0000-0000-0000000000b2');

insert into public.relatos_obra (id, obra_id, autor_id, texto, status, revisado_por, revisado_em)
values
  ('82000000-0000-0000-0000-00000000d001', '82000000-0000-0000-0000-00000000c001', '82000000-0000-0000-0000-0000000000b1',
   'Relato A1 aprovado', 'aprovado', '82000000-0000-0000-0000-0000000000a1', now()),
  ('82000000-0000-0000-0000-00000000d003', '82000000-0000-0000-0000-00000000c003', '82000000-0000-0000-0000-0000000000b2',
   'Relato B1 aprovado', 'aprovado', '82000000-0000-0000-0000-0000000000a1', now());
insert into public.relatos_obra (id, obra_id, autor_id, texto)
values ('82000000-0000-0000-0000-00000000d002', '82000000-0000-0000-0000-00000000c001', '82000000-0000-0000-0000-0000000000b1', 'Relato A1 pendente');
insert into public.relato_fotos (id, relato_id, storage_path, mime, tamanho)
values
  ('82000000-0000-0000-0000-00000000d0f1', '82000000-0000-0000-0000-00000000d001', 'relatos/82000000-0000-0000-0000-00000000c001/82000000-0000-0000-0000-00000000d001/f1.jpg', 'image/jpeg', 100),
  ('82000000-0000-0000-0000-00000000d0f2', '82000000-0000-0000-0000-00000000d002', 'relatos/82000000-0000-0000-0000-00000000c001/82000000-0000-0000-0000-00000000d002/f2.jpg', 'image/jpeg', 100),
  ('82000000-0000-0000-0000-00000000d0f3', '82000000-0000-0000-0000-00000000d003', 'relatos/82000000-0000-0000-0000-00000000c003/82000000-0000-0000-0000-00000000d003/f3.jpg', 'image/jpeg', 100);

-- Um objeto fixture em cada bucket, para provar que a permissão de um bucket não abre os outros.
insert into storage.objects (bucket_id, name)
values
  ('obras', 'relatos/82000000-0000-0000-0000-00000000c001/82000000-0000-0000-0000-00000000d001/f1.jpg'),
  ('obras', 'atualizacoes/82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000b001/f1.jpg'),
  ('documentos', '82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000d0c1.pdf'),
  ('fornecedores', '82000000-0000-0000-0000-00000000f001/contratos/c001.pdf'),
  ('site-publico', '82000000-0000-0000-0000-site/arquivo.webp');

-- ---------------------------------------------------------------------------
-- Leitura: empreendimentos, modelos e projetos (empreendimentos.ver; servidor.regras exige empreendimentos.ver).
-- O cliente lê o que é do empreendimento dele; empreiteiro e fornecedor não leem empreendimento.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.empreendimentos where id::text like '82000000-%'$q$,
  2, array['admin', 'em_v', 'em_e', 'sr'], '{"c1": 1, "c2": 1}');
select public.t8_ve(
  $q$select 1 from public.modelos_etapas where id::text like '82000000-%'$q$,
  1, array['admin', 'em_v', 'em_e', 'sr']);
select public.t8_ve(
  $q$select 1 from public.modelo_etapas_itens where id::text like '82000000-%'$q$,
  1, array['admin', 'em_v', 'em_e', 'sr']);
select public.t8_ve(
  $q$select 1 from public.modelo_categorias_documento where id::text like '82000000-%'$q$,
  1, array['admin', 'em_v', 'em_e', 'sr']);
-- projetos e categorias também são lidos por documentos.ver (R35); as etapas do projeto, não afirmo.
select public.t8_ve(
  $q$select 1 from public.projetos where id::text like '82000000-%'$q$,
  3, array['admin', 'em_v', 'em_e', 'sr', 'dc_v'], '{"c1": 2, "c2": 1}');
select public.t8_ve(
  $q$select 1 from public.projeto_etapas where id::text like '82000000-%'$q$,
  2, array['admin', 'em_v', 'em_e', 'sr'], '{"c1": 1, "c2": 1, "dc_v": null}');
select public.t8_ve(
  $q$select 1 from public.projeto_categorias_documento where id::text like '82000000-%'$q$,
  2, array['admin', 'em_v', 'em_e', 'sr', 'dc_v'], '{"c1": 1, "c2": 1}');

-- ---------------------------------------------------------------------------
-- Leitura: atualizações e fotos (o cliente só vê as publicadas do empreendimento dele).
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.atualizacoes where id::text like '82000000-%'$q$,
  3, array['admin', 'at_v', 'at_e'], '{"c1": 1, "c2": 1}');
select public.t8_ve(
  $q$select 1 from public.atualizacao_fotos where id::text like '82000000-%'$q$,
  3, array['admin', 'at_v', 'at_e'], '{"c1": 1, "c2": 1}');

-- ---------------------------------------------------------------------------
-- Leitura: obras, vínculos e relatos.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.obras where id::text like '82000000-%'$q$,
  3, array['admin', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea'], '{"c1": 2, "c2": 1, "b1": 1, "b2": 1}');
select public.t8_ve(
  $q$select 1 from public.obra_empreiteiros where profile_id::text like '82000000-%'$q$,
  2, array['admin', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea'], '{"b1": 1, "b2": 1}');
select public.t8_ve(
  $q$select 1 from public.relatos_obra where id::text like '82000000-%'$q$,
  3, array['admin', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea'], '{"c1": 1, "c2": 1, "b1": 2, "b2": 1}');
select public.t8_ve(
  $q$select 1 from public.relato_fotos where id::text like '82000000-%'$q$,
  3, array['admin', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea'], '{"c1": 1, "c2": 1, "b1": 2, "b2": 1}');

-- ---------------------------------------------------------------------------
-- Leitura: storage por bucket e por prefixo (obras: relatos/ com obras.ver, atualizacoes/ com atualizacoes.ver).
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'obras' and name like 'relatos/82000000-%'$q$,
  1, array['admin', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'obras' and name like 'atualizacoes/82000000-%'$q$,
  1, array['admin', 'at_v', 'at_e']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'documentos' and name like '82000000-%'$q$,
  1, array['admin', 'dc_v']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'fornecedores' and name like '82000000-%'$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'site-publico' and name like '82000000-%'$q$,
  1, array['admin', 'outro']);
select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('obras', 'relatos/82000000-0000-0000-0000-00000000c001/{u}.jpg')$q$,
  array[]::text[], 'enviar arquivo ao bucket obras pela sessão');
select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('obras', 'atualizacoes/82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000b001/{u}.jpg')$q$,
  array[]::text[], 'enviar foto de atualização ao bucket obras pela sessão');
select public.t8_escreve(
  $q$delete from storage.objects where bucket_id = 'obras' and name like '%82000000-%'$q$,
  array[]::text[], 'apagar objeto do bucket obras pela sessão');

-- ---------------------------------------------------------------------------
-- Funções de nome.
-- ---------------------------------------------------------------------------

-- Todas as permissões que o contrato manda abrir para nome_empreendimento; site e contatos não abrem; o painel do servidor abre.
select public.t8_ve(
  $q$select 1 where public.nome_empreendimento('82000000-0000-0000-0000-000000000e01') is not null$q$,
  1, array['admin', 'em_v', 'em_e', 'sr', 'at_v', 'at_e', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea', 'dc_v', 'cl_v'], '{"c1": 1, "b1": 1, "outro": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_empreendimento('82000000-0000-0000-0000-000000000e02') is not null$q$,
  1, array['admin', 'em_v', 'em_e', 'sr', 'at_v', 'at_e', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea', 'dc_v', 'cl_v'], '{"c2": 1, "b2": 1, "outro": 1}');
-- Empreiteiro: obras.ver; o cliente da obra também vê o nome do empreiteiro dela.
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('82000000-0000-0000-0000-0000000000b1') is not null$q$,
  1, array['admin', 'ob_v', 'ob_e', 'ob_ap', 'ob_ea'], '{"b1": 1, "c1": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('82000000-0000-0000-0000-0000000000e1') is not null$q$,
  1, array['admin'], '{"em_v": 1}');
select public.t8_ve(
  $q$select 1 where public.nome_pessoa('82000000-0000-0000-0000-0000000000a1') is not null$q$,
  1, array['admin']);

-- ---------------------------------------------------------------------------
-- Escrita: empreendimentos. Apagar empreendimento é só do admin (R10: o DELETE leva tudo em cascata).
-- O PostgREST manda todas as colunas no SET: uma edição que não muda codigo_pasta nem a liberação passa.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.empreendimentos (id, nome) values ('{u}', 'T8 empreendimento novo {n}')$q$,
  array['admin', 'em_e'], 'criar empreendimento');
select public.t8_escreve(
  $q$update public.empreendimentos
        set nome = 'T8 editado {n}', cidade = 'Cidade T8', descricao = 'x',
            codigo_pasta = codigo_pasta, liberacao_automatica = liberacao_automatica
      where id = '82000000-0000-0000-0000-000000000e02'$q$,
  array['admin', 'em_e'], 'editar empreendimento (todas as colunas no SET)');
select public.t8_escreve(
  $q$delete from public.empreendimentos where id = '{u}'$q$,
  array['admin'], 'apagar empreendimento',
  $q$insert into public.empreendimentos (id, nome) values ('{u}', 'T8 empreendimento descartável {n}')$q$);

-- ---------------------------------------------------------------------------
-- Escrita: modelos de etapas e categorias de modelo.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.modelos_etapas (id, nome) values ('{u}', 'T8 modelo {u}')$q$,
  array['admin', 'em_e'], 'criar modelo');
select public.t8_escreve(
  $q$update public.modelos_etapas set descricao = 'T8 editado' where id = '82000000-0000-0000-0000-00000000a0d1'$q$,
  array['admin', 'em_e'], 'editar modelo');
select public.t8_escreve(
  $q$delete from public.modelos_etapas where id = '{u}'$q$,
  array['admin', 'em_e'], 'apagar modelo',
  $q$insert into public.modelos_etapas (id, nome) values ('{u}', 'T8 modelo descartável {u}')$q$);
select public.t8_escreve(
  $q$insert into public.modelo_etapas_itens (id, modelo_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a0d1', 'T8 etapa', 100 + {n})$q$,
  array['admin', 'em_e'], 'criar item de modelo');
select public.t8_escreve(
  $q$update public.modelo_etapas_itens set nome = 'T8 etapa editada' where id = '82000000-0000-0000-0000-00000000a0e1'$q$,
  array['admin', 'em_e'], 'editar item de modelo');
select public.t8_escreve(
  $q$delete from public.modelo_etapas_itens where id = '{u}'$q$,
  array['admin', 'em_e'], 'apagar item de modelo',
  $q$insert into public.modelo_etapas_itens (id, modelo_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a0d1', 'T8 etapa descartável', 200 + {n})$q$);
select public.t8_escreve(
  $q$insert into public.modelo_categorias_documento (id, modelo_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a0d1', 'T8 categoria {u}', 100 + {n})$q$,
  array['admin', 'em_e'], 'criar categoria de modelo');
select public.t8_escreve(
  $q$update public.modelo_categorias_documento set ordem = ordem where id = '82000000-0000-0000-0000-00000000a0c1'$q$,
  array['admin', 'em_e'], 'editar categoria de modelo');
select public.t8_escreve(
  $q$delete from public.modelo_categorias_documento where id = '{u}'$q$,
  array['admin', 'em_e'], 'apagar categoria de modelo',
  $q$insert into public.modelo_categorias_documento (id, modelo_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a0d1', 'T8 categoria descartável {u}', 200 + {n})$q$);

-- ---------------------------------------------------------------------------
-- Escrita: projetos, etapas e categorias do projeto, e as funções que os montam.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.projetos (id, empreendimento_id, nome)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', 'T8 projeto {u}')$q$,
  array['admin', 'em_e'], 'criar projeto');
select public.t8_escreve(
  $q$update public.projetos set nome = 'T8 projeto editado {n}' where id = '82000000-0000-0000-0000-00000000a001'$q$,
  array['admin', 'em_e'], 'editar projeto');
select public.t8_escreve(
  $q$delete from public.projetos where id = '{u}'$q$,
  array['admin', 'em_e'], 'apagar projeto',
  $q$insert into public.projetos (id, empreendimento_id, nome)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', 'T8 projeto descartável {u}')$q$);
select public.t8_escreve(
  $q$insert into public.projeto_etapas (id, projeto_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a001', 'T8 etapa', 100 + {n})$q$,
  array['admin', 'em_e'], 'criar etapa de projeto');
select public.t8_escreve(
  $q$update public.projeto_etapas set concluida_em = '2027-01-01' where id = '82000000-0000-0000-0000-00000000a0a1'$q$,
  array['admin', 'em_e'], 'concluir etapa de projeto');
select public.t8_escreve(
  $q$delete from public.projeto_etapas where id = '{u}'$q$,
  array['admin', 'em_e'], 'apagar etapa de projeto',
  $q$insert into public.projeto_etapas (id, projeto_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a001', 'T8 etapa descartável', 200 + {n})$q$);
select public.t8_escreve(
  $q$insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a001', 'T8 categoria {u}', 100 + {n})$q$,
  array['admin', 'em_e'], 'criar categoria de projeto');
select public.t8_escreve(
  $q$update public.projeto_categorias_documento set nome = 'T8 categoria editada {n}' where id = '82000000-0000-0000-0000-00000000a0b1'$q$,
  array['admin', 'em_e'], 'editar categoria de projeto');
select public.t8_escreve(
  $q$delete from public.projeto_categorias_documento where id = '{u}'$q$,
  array['admin', 'em_e'], 'apagar categoria de projeto',
  $q$insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
     values ('{u}', '82000000-0000-0000-0000-00000000a001', 'T8 categoria descartável {u}', 200 + {n})$q$);

select public.t8_escreve(
  $q$select public.criar_projeto_de_modelo('82000000-0000-0000-0000-000000000e01', '82000000-0000-0000-0000-00000000a0d1', 'T8 projeto da função {u}')$q$,
  array['admin', 'em_e'], 'criar projeto a partir de modelo');
select public.t8_escreve(
  $q$select public.salvar_modelo_portal(null, 'T8 modelo da função {u}', null, true,
       '[{"nome": "Etapa T8", "ordem": 1}]'::jsonb, '[{"nome": "Categoria T8", "ordem": 1}]'::jsonb)$q$,
  array['admin', 'em_e'], 'salvar modelo (função)');
select public.t8_escreve(
  $q$select public.salvar_etapas_projeto_portal('82000000-0000-0000-0000-00000000a003', null,
       '[{"nome": "Etapa T8", "ordem": 1}]'::jsonb, '[{"nome": "Categoria T8", "ordem": 1}]'::jsonb)$q$,
  array['admin', 'em_e'], 'salvar etapas do projeto (função)');
select public.t8_escreve(
  $q$select public.validar_lista_portal('[{"nome": "Etapa T8", "ordem": 1}]'::jsonb, true, false)$q$,
  array['admin', 'em_e'], 'validar lista (função)');

-- ---------------------------------------------------------------------------
-- Escrita: atualizações e fotos.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.atualizacoes (id, empreendimento_id, titulo)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', 'T8 atualização')$q$,
  array['admin', 'at_e'], 'criar atualização');
select public.t8_escreve(
  $q$update public.atualizacoes set publicado = true where id = '82000000-0000-0000-0000-00000000b002'$q$,
  array['admin', 'at_e'], 'publicar atualização');
select public.t8_escreve(
  $q$delete from public.atualizacoes where id = '{u}'$q$,
  array['admin', 'at_e'], 'apagar atualização',
  $q$insert into public.atualizacoes (id, empreendimento_id, titulo)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', 'T8 descartável')$q$);
select public.t8_escreve(
  $q$insert into public.atualizacao_fotos (id, atualizacao_id, storage_path, mime, tamanho)
     values ('{u}', '82000000-0000-0000-0000-00000000b001', 'atualizacoes/82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000b001/{u}.jpg', 'image/jpeg', 100)$q$,
  array['admin', 'at_e'], 'anexar foto à atualização');
select public.t8_escreve(
  $q$update public.atualizacao_fotos set ordem = 5 where id = '82000000-0000-0000-0000-00000000b0f1'$q$,
  array['admin', 'at_e'], 'reordenar foto de atualização');
select public.t8_escreve(
  $q$delete from public.atualizacao_fotos where id = '{u}'$q$,
  array['admin', 'at_e'], 'apagar foto de atualização',
  $q$insert into public.atualizacao_fotos (id, atualizacao_id, storage_path, mime, tamanho)
     values ('{u}', '82000000-0000-0000-0000-00000000b001', 'atualizacoes/82000000-0000-0000-0000-000000000e01/82000000-0000-0000-0000-00000000b001/{u}.jpg', 'image/jpeg', 100)$q$);

-- ---------------------------------------------------------------------------
-- Escrita: obras e vínculos de empreiteiro (validar_vinculos_acesso lê profiles sob o RLS de quem grava).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.obras (id, empreendimento_id, nome)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', 'T8 obra nova {n}')$q$,
  array['admin', 'ob_e', 'ob_ea'], 'criar obra');
-- obras.editar muda o nome (inclusive com percentual e situação no SET, sem alterá-los), mas não percentual nem situação.
select public.t8_escreve(
  $q$update public.obras set nome = 'T8 obra renomeada {n}' where id = '82000000-0000-0000-0000-00000000c002'$q$,
  array['admin', 'ob_e', 'ob_ea'], 'renomear obra');
select public.t8_escreve(
  $q$update public.obras
        set nome = 'T8 obra completa {n}', percentual = percentual, situacao = situacao,
            previsto_inicio = '2027-02-01', previsto_fim = '2027-12-01'
      where id = '82000000-0000-0000-0000-00000000c002'$q$,
  array['admin', 'ob_e', 'ob_ea'], 'editar obra (todas as colunas no SET, sem mudar percentual nem situação)');
select public.t8_escreve(
  $q$update public.obras set percentual = (percentual + 1) % 100 where id = '82000000-0000-0000-0000-00000000c002'$q$,
  array['admin', 'ob_ea'], 'mudar percentual da obra diretamente');
select public.t8_escreve(
  $q$update public.obras
        set situacao = case situacao when 'planejada' then 'em_andamento'::public.obra_situacao else 'planejada'::public.obra_situacao end
      where id = '82000000-0000-0000-0000-00000000c002'$q$,
  array['admin', 'ob_ea'], 'mudar situação da obra diretamente');
select public.t8_escreve(
  $q$update public.obras
        set nome = 'T8 obra com percentual {n}', percentual = (percentual + 1) % 100
      where id = '82000000-0000-0000-0000-00000000c002'$q$,
  array['admin', 'ob_ea'], 'renomear e mudar percentual na mesma gravação');
select public.t8_escreve(
  $q$delete from public.obras where id = '{u}'$q$,
  array['admin', 'ob_e', 'ob_ea'], 'apagar obra',
  $q$insert into public.obras (id, empreendimento_id, nome) values ('{u}', '82000000-0000-0000-0000-000000000e01', 'T8 obra descartável')$q$);

select public.t8_escreve(
  $q$insert into public.obra_empreiteiros (obra_id, profile_id)
     values ('82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b3')$q$,
  array['admin', 'ob_e', 'ob_ea'], 'vincular empreiteiro à obra',
  $q$delete from public.obra_empreiteiros where profile_id = '82000000-0000-0000-0000-0000000000b3'$q$);
select public.t8_escreve(
  $q$insert into public.obra_empreiteiros (obra_id, profile_id)
     values ('82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000c1')$q$,
  array[]::text[], 'vincular cliente como empreiteiro',
  $q$delete from public.obra_empreiteiros where profile_id = '82000000-0000-0000-0000-0000000000c1'$q$);
select public.t8_escreve(
  $q$update public.obra_empreiteiros set obra_id = obra_id where profile_id = '82000000-0000-0000-0000-0000000000b1'$q$,
  array['admin', 'ob_e', 'ob_ea'], 'atualizar vínculo de empreiteiro');
select public.t8_escreve(
  $q$delete from public.obra_empreiteiros where profile_id = '82000000-0000-0000-0000-0000000000b3'$q$,
  array['admin', 'ob_e', 'ob_ea'], 'desvincular empreiteiro',
  $q$insert into public.obra_empreiteiros (obra_id, profile_id)
     values ('82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b3') on conflict do nothing$q$);

-- ---------------------------------------------------------------------------
-- Escrita: relatos de obra e fotos. Revisar (UPDATE do relatos_obra) é obras.aprovar; criar e apagar relato e
-- mexer nas fotos é só do admin (R39: o relato nasce por enviar_relato_obra, as fotos pela rota).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$update public.relatos_obra set status = 'aprovado' where id = '{u}'$q$,
  array['admin', 'ob_ap', 'ob_ea'], 'aprovar relato por UPDATE',
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto)
     values ('{u}', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 relato a revisar')$q$);
select public.t8_escreve(
  $q$update public.relatos_obra set status = 'devolvido', motivo_devolucao = 'Faltou foto' where id = '{u}'$q$,
  array['admin', 'ob_ap', 'ob_ea'], 'devolver relato por UPDATE',
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto)
     values ('{u}', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 relato a devolver')$q$);
select public.t8_escreve(
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto)
     values ('{u}', '82000000-0000-0000-0000-00000000c001', '82000000-0000-0000-0000-0000000000b1', 'T8 relato novo')$q$,
  array['admin'], 'criar relato');
select public.t8_escreve(
  $q$delete from public.relatos_obra where id = '{u}'$q$,
  array['admin'], 'apagar relato',
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto)
     values ('{u}', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 relato descartável')$q$);
select public.t8_escreve(
  $q$insert into public.relato_fotos (id, relato_id, storage_path, mime, tamanho)
     values ('{u}', '82000000-0000-0000-0000-00000000d002',
             'relatos/82000000-0000-0000-0000-00000000c001/82000000-0000-0000-0000-00000000d002/{u}.jpg', 'image/jpeg', 100)$q$,
  array['admin'], 'anexar foto ao relato',
  $q$delete from public.relato_fotos where relato_id = '82000000-0000-0000-0000-00000000d002' and id::text not like '82000000-%'$q$);
select public.t8_escreve(
  $q$update public.relato_fotos set tamanho = 200 where id = '82000000-0000-0000-0000-00000000d0f2'$q$,
  array[]::text[], 'alterar foto de relato (sem grant de update para ninguém)');
select public.t8_escreve(
  $q$delete from public.relato_fotos where id = '{u}'$q$,
  array['admin'], 'apagar foto de relato',
  $q$delete from public.relato_fotos where relato_id = '82000000-0000-0000-0000-00000000d002' and id::text not like '82000000-%';
     insert into public.relato_fotos (id, relato_id, storage_path, mime, tamanho)
     values ('{u}', '82000000-0000-0000-0000-00000000d002',
             'relatos/82000000-0000-0000-0000-00000000c001/82000000-0000-0000-0000-00000000d002/{u}.jpg', 'image/jpeg', 100)$q$);

-- revisar_relato_obra: obras.aprovar basta (sem obras.editar); obras.editar sozinho não aprova.
select public.t8_escreve(
  $q$select public.revisar_relato_obra('{u}', 'aprovar', null, 30, 'em_andamento')$q$,
  array['admin', 'ob_ap', 'ob_ea'], 'aprovar relato pela função',
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto)
     values ('{u}', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 relato da função')$q$);
select public.t8_escreve(
  $q$select public.revisar_relato_obra('{u}', 'devolver', 'Faltou foto', null, null)$q$,
  array['admin', 'ob_ap', 'ob_ea'], 'devolver relato pela função',
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto)
     values ('{u}', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 relato da função')$q$);

-- obras.aprovar aprova SEM obras.editar e isso muda o percentual e a situação que o cliente vê; devolver não muda.
do $$
begin
  update public.obras set percentual = 5, situacao = 'planejada' where id = '82000000-0000-0000-0000-00000000c002';
  insert into public.relatos_obra (id, obra_id, autor_id, texto)
  values ('82000000-0000-0000-0000-00000000d0a1', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 aprovar muda percentual'),
         ('82000000-0000-0000-0000-00000000d0a2', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 devolver não muda');

  perform public.t8_pode('ob_ap',
    $q$select public.revisar_relato_obra('82000000-0000-0000-0000-00000000d0a2', 'devolver', 'Faltou foto', null, null)$q$,
    'obras.aprovar devolver relato');
  if (select percentual from public.obras where id = '82000000-0000-0000-0000-00000000c002') <> 5 then
    raise exception 'FALHA: devolver relato mudou o percentual da obra';
  end if;

  perform public.t8_pode('ob_ap',
    $q$select public.revisar_relato_obra('82000000-0000-0000-0000-00000000d0a1', 'aprovar', null, 77, 'em_andamento')$q$,
    'obras.aprovar aprovar relato (sem obras.editar)');
  if (select percentual from public.obras where id = '82000000-0000-0000-0000-00000000c002') <> 77
     or (select situacao from public.obras where id = '82000000-0000-0000-0000-00000000c002') <> 'em_andamento' then
    raise exception 'FALHA: aprovar relato por obras.aprovar não mudou o percentual/situação da obra';
  end if;
  if (select status from public.relatos_obra where id = '82000000-0000-0000-0000-00000000d0a1') <> 'aprovado' then
    raise exception 'FALHA: o relato aprovado por obras.aprovar não ficou aprovado';
  end if;
  if (select status from public.relatos_obra where id = '82000000-0000-0000-0000-00000000d0a2') <> 'devolvido' then
    raise exception 'FALHA: o relato devolvido por obras.aprovar não ficou devolvido';
  end if;

  -- Sem obras.aprovar (só editar) a mesma aprovação é recusada e nada muda.
  insert into public.relatos_obra (id, obra_id, autor_id, texto)
  values ('82000000-0000-0000-0000-00000000d0a3', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-0000000000b1', 'T8 sem aprovar');
  perform public.t8_nao_pode('ob_e',
    $q$select public.revisar_relato_obra('82000000-0000-0000-0000-00000000d0a3', 'aprovar', null, 99, 'em_andamento')$q$,
    'obras.editar sem aprovar aprovar relato');
  perform public.t8_nao_pode('ob_v',
    $q$select public.revisar_relato_obra('82000000-0000-0000-0000-00000000d0a3', 'aprovar', null, 99, 'em_andamento')$q$,
    'obras.ver aprovar relato');
  perform public.t8_nao_pode('c1',
    $q$select public.revisar_relato_obra('82000000-0000-0000-0000-00000000d0a3', 'aprovar', null, 99, 'em_andamento')$q$,
    'cliente aprovar relato');
  perform public.t8_nao_pode('b1',
    $q$select public.revisar_relato_obra('82000000-0000-0000-0000-00000000d0a3', 'aprovar', null, 99, 'em_andamento')$q$,
    'empreiteiro aprovar o próprio relato');
  if (select percentual from public.obras where id = '82000000-0000-0000-0000-00000000c002') <> 77
     or (select status from public.relatos_obra where id = '82000000-0000-0000-0000-00000000d0a3') <> 'pendente' then
    raise exception 'FALHA: aprovação recusada mexeu na obra ou no relato';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Integração com os triggers validar_vinculos_portal (leem projetos e etapas sob o RLS de quem grava).
-- Ficam por último: se a migration deixar quem só tem atualizacoes.editar sem enxergar/travar o projeto, é aqui que aparece.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.atualizacoes (id, empreendimento_id, projeto_id, etapa_id, titulo)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', '82000000-0000-0000-0000-00000000a001',
             '82000000-0000-0000-0000-00000000a0a1', 'T8 atualização com projeto e etapa')$q$,
  array['admin', 'at_e'], 'criar atualização ligada a projeto e etapa (validar_vinculos_portal)');
select public.t8_escreve(
  $q$insert into public.atualizacoes (id, empreendimento_id, projeto_id, etapa_id, titulo)
     values ('{u}', '82000000-0000-0000-0000-000000000e01', '82000000-0000-0000-0000-00000000a002',
             '82000000-0000-0000-0000-00000000a0a2', 'T8 atualização com projeto de outro empreendimento')$q$,
  array[]::text[], 'ligar atualização a projeto de outro empreendimento');

-- Depois de toda a matriz, a fixture continua inteira.
do $$
begin
  if (select count(*) from public.empreendimentos where id in (
        '82000000-0000-0000-0000-000000000e01', '82000000-0000-0000-0000-000000000e02')) <> 2 then
    raise exception 'FALHA: a matriz apagou empreendimento da fixture';
  end if;
  if (select count(*) from public.obras where id in (
        '82000000-0000-0000-0000-00000000c001', '82000000-0000-0000-0000-00000000c002', '82000000-0000-0000-0000-00000000c003')) <> 3 then
    raise exception 'FALHA: a matriz apagou obra da fixture';
  end if;
  if (select count(*) from public.relatos_obra where id in (
        '82000000-0000-0000-0000-00000000d001', '82000000-0000-0000-0000-00000000d002', '82000000-0000-0000-0000-00000000d003')) <> 3 then
    raise exception 'FALHA: a matriz apagou relato da fixture';
  end if;
  if (select status from public.relatos_obra where id = '82000000-0000-0000-0000-00000000d002') <> 'pendente' then
    raise exception 'FALHA: o relato pendente da fixture foi revisado por quem não podia';
  end if;
  if (select percentual from public.obras where id = '82000000-0000-0000-0000-00000000c001') <> 10 then
    raise exception 'FALHA: o percentual da obra A1 mudou sem aprovação';
  end if;
end $$;

select 'OK: empreendimentos, projetos, atualizações, obras e relatos da Etapa 8 passaram na matriz de RLS' as resultado;

rollback;
