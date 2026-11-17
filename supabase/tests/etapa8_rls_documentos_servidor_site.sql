-- Testes da Etapa 8, onda 4 — matriz de RLS: documentos, servidor (conector, regras de pasta, painel) e conteúdo do site.
-- Conferência independente do contrato (docs/ETAPA-8-CONTRATO.md §6 e §7) e das resoluções do anexo
-- (docs/ETAPA-8-ANEXO-LEVANTAMENTO.md, "Resoluções do coordenador" e Parte D). Foi escrito sem ler as migrations
-- de RLS da onda 4.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo as de RLS da etapa 8, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_rls_documentos_servidor_site.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa8_rls_documentos_servidor_site.sql)
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina em ROLLBACK. Se alguma
-- verificação falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O banco de produção tem dados reais e 1 conector ativo: toda contagem filtra pelos ids da fixture (prefixo
-- 83000000-), nenhuma verificação depende de tabela vazia, e o conector real é revogado só dentro da transação.
--
-- Como a matriz funciona: t8_ve(consulta, total, quem lê, exceções) confere, para CADA conta, quantas linhas
-- da fixture ela enxerga (quem não está na lista enxerga 0); t8_escreve(comando, quem pode, ...) roda o comando
-- como cada conta e exige sucesso só de quem está na lista. "admin" entra nas listas de forma explícita.
-- A conta "servico" é a secret key (set role service_role): precisa passar pelos triggers de colunas da D5.
--
-- Contas (ids 83000000-0000-0000-0000-0000000000xx):
--   admin (a1); equipe: n0 (e0, sem nada), dc_v (e1, documentos.ver), dc_e (e2, +editar), dc_l (e3, ver+liberar, sem editar),
--   dc_el (e4, ver+editar+liberar), sr (e5, empreendimentos.ver+servidor.regras), sr_ed (e6, sr + empreendimentos.editar),
--   em_e (e7, empreendimentos.ver+editar), ps (e8, painel.servidor), st_v (e9, site.ver), st_e (ea, +editar),
--   ct_v (eb, contatos.ver), ct_e (ec, +editar), outro (ee, financeiro.*, clientes.*, fornecedores.*),
--   inativa (ef, as 22, ativo=false), pendente (f0, as 22, troca de senha pendente);
--   clientes c1 (do empreendimento A) e c2 (do B); empreiteiro b1; fornecedor f1; mais anon.
-- Dados: empreendimentos A (e01, pasta 831001, liberação automática desligada) e B (e02, pasta 831002, ligada);
--   documentos dA_lib/dB_lib (liberados), dA_rasc, d_serv (na fila do servidor) e d_ign (ignorado); regras de pasta
--   rOff (desligada) e rOn (ligada); um conector (revogado) com um envio; conteúdo do site publicado e oculto.

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

-- Todas as contas, para as leituras públicas.
create function public.t8_todos()
returns text[]
language sql
as $$
  select array_agg(c.chave) || array['anon'] from public.t8_contas c
$$;

-- ---------------------------------------------------------------------------
-- Fixture.
-- ---------------------------------------------------------------------------

-- O banco aceita um só conector ativo, e o de produção já existe. Revogá-lo aqui vale só dentro desta
-- transação, que termina em ROLLBACK: o conector real não é afetado.
update public.conectores set revogado_em = now() where revogado_em is null;

select public.t8_conta('admin', '83000000-0000-0000-0000-0000000000a1', 'admin');
select public.t8_conta('n0', '83000000-0000-0000-0000-0000000000e0', 'equipe');
select public.t8_conta('dc_v', '83000000-0000-0000-0000-0000000000e1', 'equipe', array['documentos.ver']);
select public.t8_conta('dc_e', '83000000-0000-0000-0000-0000000000e2', 'equipe', array['documentos.ver', 'documentos.editar']);
select public.t8_conta('dc_l', '83000000-0000-0000-0000-0000000000e3', 'equipe', array['documentos.ver', 'documentos.liberar']);
select public.t8_conta('dc_el', '83000000-0000-0000-0000-0000000000e4', 'equipe',
  array['documentos.ver', 'documentos.editar', 'documentos.liberar']);
select public.t8_conta('sr', '83000000-0000-0000-0000-0000000000e5', 'equipe', array['empreendimentos.ver', 'servidor.regras']);
select public.t8_conta('sr_ed', '83000000-0000-0000-0000-0000000000e6', 'equipe',
  array['empreendimentos.ver', 'empreendimentos.editar', 'servidor.regras']);
select public.t8_conta('em_e', '83000000-0000-0000-0000-0000000000e7', 'equipe', array['empreendimentos.ver', 'empreendimentos.editar']);
select public.t8_conta('ps', '83000000-0000-0000-0000-0000000000e8', 'equipe', array['painel.servidor']);
select public.t8_conta('st_v', '83000000-0000-0000-0000-0000000000e9', 'equipe', array['site.ver']);
select public.t8_conta('st_e', '83000000-0000-0000-0000-0000000000ea', 'equipe', array['site.ver', 'site.editar']);
select public.t8_conta('ct_v', '83000000-0000-0000-0000-0000000000eb', 'equipe', array['contatos.ver']);
select public.t8_conta('ct_e', '83000000-0000-0000-0000-0000000000ec', 'equipe', array['contatos.ver', 'contatos.editar']);
select public.t8_conta('outro', '83000000-0000-0000-0000-0000000000ee', 'equipe',
  array['financeiro.ver', 'financeiro.editar', 'clientes.ver', 'clientes.editar', 'fornecedores.ver', 'fornecedores.editar']);
select public.t8_conta('inativa', '83000000-0000-0000-0000-0000000000ef', 'equipe', public.catalogo_permissoes(), false, false);
select public.t8_conta('pendente', '83000000-0000-0000-0000-0000000000f0', 'equipe', public.catalogo_permissoes(), true, true);
select public.t8_conta('c1', '83000000-0000-0000-0000-0000000000c1', 'cliente');
select public.t8_conta('c2', '83000000-0000-0000-0000-0000000000c2', 'cliente');
select public.t8_conta('b1', '83000000-0000-0000-0000-0000000000b1', 'empreiteiro');
select public.t8_conta('f1', '83000000-0000-0000-0000-0000000000f1', 'fornecedor');

-- Inseridos como postgres: os triggers de colunas deixam passar (current_user fora de anon/authenticated).
insert into public.empreendimentos (id, nome, codigo_pasta, liberacao_automatica)
values
  ('83000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste E8d', '831001', false),
  ('83000000-0000-0000-0000-000000000e02', 'Empreendimento B Teste E8d', '831002', true);

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('83000000-0000-0000-0000-000000000e01', '83000000-0000-0000-0000-0000000000c1'),
  ('83000000-0000-0000-0000-000000000e02', '83000000-0000-0000-0000-0000000000c2');

insert into public.projetos (id, empreendimento_id, nome)
values ('83000000-0000-0000-0000-00000000a001', '83000000-0000-0000-0000-000000000e01', 'Projeto A Teste E8d');
insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values ('83000000-0000-0000-0000-00000000a0b1', '83000000-0000-0000-0000-00000000a001', 'Categoria A', 1);

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente)
values
  ('83000000-0000-0000-0000-00000000d0a1', '83000000-0000-0000-0000-000000000e01', 'Documento A liberado',
   '83000000-0000-0000-0000-000000000e01/d0a1.pdf', 'application/pdf', 100, repeat('1', 64), true),
  ('83000000-0000-0000-0000-00000000d0a2', '83000000-0000-0000-0000-000000000e01', 'Documento A rascunho',
   '83000000-0000-0000-0000-000000000e01/d0a2.pdf', 'application/pdf', 100, repeat('2', 64), false),
  ('83000000-0000-0000-0000-00000000d0b1', '83000000-0000-0000-0000-000000000e02', 'Documento B liberado',
   '83000000-0000-0000-0000-000000000e02/d0b1.pdf', 'application/pdf', 100, repeat('3', 64), true),
  ('83000000-0000-0000-0000-00000000d0c1', '83000000-0000-0000-0000-000000000e01', 'Documento da fila',
   '83000000-0000-0000-0000-000000000e01/d0c1.pdf', 'application/pdf', 100, repeat('4', 64), false),
  ('83000000-0000-0000-0000-00000000d0c2', '83000000-0000-0000-0000-000000000e01', 'Documento ignorado',
   '83000000-0000-0000-0000-000000000e01/d0c2.pdf', 'application/pdf', 100, repeat('5', 64), false);

insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256, ignorado_em)
values
  ('83000000-0000-0000-0000-00000000d0c1', 'x/fila.pdf', 100, repeat('4', 64), null),
  ('83000000-0000-0000-0000-00000000d0c2', 'x/ignorado.pdf', 100, repeat('5', 64), now());

insert into public.conectores (id, nome, token_hash, revogado_em)
values ('83000000-0000-0000-0000-00000000c001', 'Conector teste E8d', repeat('a', 64), now());
insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado)
values ('83000000-0000-0000-0000-00000000c001', '83000000-0000-0000-0000-000000000e01', 'x/fila.pdf', 100, repeat('4', 64), 'autorizado');

insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo, liberar_automatico)
values
  ('83000000-0000-0000-0000-00000000f0a1', '83000000-0000-0000-0000-000000000e01', 'REGRA T8 DESLIGADA', 'contratos', false),
  ('83000000-0000-0000-0000-00000000f0a2', '83000000-0000-0000-0000-000000000e01', 'REGRA T8 LIGADA', 'orcamentos', true);

-- Conteúdo do site: um publicado e um oculto de cada.
insert into public.servicos (id, titulo, slug, publicado)
values ('83000000-0000-0000-0000-00000000a1a1', 'Serviço publicado T8', 't8-serv-pub', true),
       ('83000000-0000-0000-0000-00000000a1a2', 'Serviço oculto T8', 't8-serv-ocu', false);
insert into public.portfolio_projetos (id, titulo, slug, publicado)
values ('83000000-0000-0000-0000-00000000a2a1', 'Portfólio publicado T8', 't8-port-pub', true),
       ('83000000-0000-0000-0000-00000000a2a2', 'Portfólio oculto T8', 't8-port-ocu', false);
insert into public.loteamentos (id, nome, slug, publicado)
values ('83000000-0000-0000-0000-00000000a3a1', 'Loteamento publicado T8', 't8-lot-pub', true),
       ('83000000-0000-0000-0000-00000000a3a2', 'Loteamento oculto T8', 't8-lot-ocu', false);
insert into public.lotes (id, loteamento_id, quadra, numero)
values ('83000000-0000-0000-0000-00000000a4a1', '83000000-0000-0000-0000-00000000a3a1', 'Q0', '1'),
       ('83000000-0000-0000-0000-00000000a4a2', '83000000-0000-0000-0000-00000000a3a2', 'Q0', '1');
insert into public.midias (id, tipo, storage_path, loteamento_id)
values ('83000000-0000-0000-0000-00000000a5a1', 'foto', 'loteamentos/83000000-0000-0000-0000-00000000a3a1/m1.webp', '83000000-0000-0000-0000-00000000a3a1'),
       ('83000000-0000-0000-0000-00000000a5a2', 'foto', 'loteamentos/83000000-0000-0000-0000-00000000a3a2/m2.webp', '83000000-0000-0000-0000-00000000a3a2');
insert into public.depoimentos (id, nome, texto, publicado)
values ('83000000-0000-0000-0000-00000000a6a1', 'Depoimento publicado T8', 'Texto', true),
       ('83000000-0000-0000-0000-00000000a6a2', 'Depoimento oculto T8', 'Texto', false);
insert into public.parceiros (id, nome, logo_path, publicado)
values ('83000000-0000-0000-0000-00000000a7a1', 'Parceiro publicado T8', 'parceiros/t8-pub.webp', true),
       ('83000000-0000-0000-0000-00000000a7a2', 'Parceiro oculto T8', 'parceiros/t8-ocu.webp', false);
insert into public.banners_hero (id, sobrancelha, titulo, texto, imagem_path, publicado)
values ('83000000-0000-0000-0000-00000000a8a1', 'T8', 'Banner publicado T8', 'Texto', 'hero/t8-pub.webp', true),
       ('83000000-0000-0000-0000-00000000a8a2', 'T8', 'Banner oculto T8', 'Texto', 'hero/t8-ocu.webp', false);
insert into public.videos_instagram (id, video_path, publicado)
values ('83000000-0000-0000-0000-00000000a9a1', 'instagram/t8-pub.mp4', true),
       ('83000000-0000-0000-0000-00000000a9a2', 'instagram/t8-ocu.mp4', false);
insert into public.contatos (id, nome, mensagem)
values ('83000000-0000-0000-0000-00000000aaa1', 'Contato 1 T8', 'Mensagem 1'),
       ('83000000-0000-0000-0000-00000000aaa2', 'Contato 2 T8', 'Mensagem 2');
-- Linha única: se já existir (produção), a fixture usa a existente.
insert into public.configuracoes_site (whatsapp) values ('0000000000') on conflict (unico) do nothing;

-- Um objeto fixture em cada bucket, para provar que a permissão de um bucket não abre os outros.
insert into storage.objects (bucket_id, name)
values
  ('documentos', '83000000-0000-0000-0000-000000000e01/83000000-0000-0000-0000-00000000d0a1.pdf'),
  ('site-publico', '83000000-0000-0000-0000-site/arquivo.webp'),
  ('fornecedores', '83000000-0000-0000-0000-00000000f001/contratos/c001.pdf'),
  ('obras', 'relatos/83000000-0000-0000-0000-00000000c001/83000000-0000-0000-0000-00000000d001/f1.jpg'),
  ('obras', 'atualizacoes/83000000-0000-0000-0000-000000000e01/f1.jpg');

-- ---------------------------------------------------------------------------
-- Leitura: documentos (o cliente só lê os liberados do empreendimento dele) e origens (documentos.liberar, R37).
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.documentos where id::text like '83000000-%'$q$,
  5, array['admin', 'dc_v', 'dc_e', 'dc_l', 'dc_el'], '{"c1": 1, "c2": 1}');
select public.t8_ve(
  $q$select 1 from public.documento_origens where documento_id::text like '83000000-%'$q$,
  2, array['admin', 'dc_l', 'dc_el']);
-- projetos e categorias: empreendimentos.ver ou documentos.ver (R35); o cliente continua lendo os do empreendimento dele.
select public.t8_ve(
  $q$select 1 from public.projetos where id::text like '83000000-%'$q$,
  1, array['admin', 'em_e', 'sr', 'sr_ed', 'dc_v', 'dc_e', 'dc_l', 'dc_el'], '{"c1": 1}');
select public.t8_ve(
  $q$select 1 from public.projeto_categorias_documento where id::text like '83000000-%'$q$,
  1, array['admin', 'em_e', 'sr', 'sr_ed', 'dc_v', 'dc_e', 'dc_l', 'dc_el'], '{"c1": 1}');

-- ---------------------------------------------------------------------------
-- Leitura: servidor. conectores e configuracoes_conector: painel.servidor ou servidor.regras (R36);
-- conector_envios: só painel.servidor; pasta_regras: só servidor.regras; empreendimentos: empreendimentos.ver.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from public.conectores where id::text like '83000000-%'$q$,
  1, array['admin', 'ps', 'sr', 'sr_ed']);
-- Linha única da configuração geral (a de produção): todo mundo que pode ler enxerga uma.
select public.t8_ve(
  $q$select 1 from public.configuracoes_conector$q$,
  1, array['admin', 'ps', 'sr', 'sr_ed']);
select public.t8_ve(
  $q$select 1 from public.conector_envios where conector_id::text like '83000000-%'$q$,
  1, array['admin', 'ps']);
select public.t8_ve(
  $q$select 1 from public.pasta_regras where id::text like '83000000-%'$q$,
  2, array['admin', 'sr', 'sr_ed']);
select public.t8_ve(
  $q$select 1 from public.empreendimentos where id::text like '83000000-%'$q$,
  2, array['admin', 'em_e', 'sr', 'sr_ed'], '{"c1": 1, "c2": 1}');
-- A chave do conector nunca é legível, nem pelo admin.
select public.t8_escreve(
  $q$select token_hash from public.conectores where id::text like '83000000-%'$q$,
  array[]::text[], 'ler token_hash');

-- ---------------------------------------------------------------------------
-- Leitura: conteúdo do site. Publicado é público (inclusive anon); oculto só com site.ver. contatos: contatos.ver.
-- ---------------------------------------------------------------------------

select public.t8_ve(f.publicados, 1, public.t8_todos()), public.t8_ve(f.ocultos, 1, array['admin', 'st_v', 'st_e'])
from (values
  ($q$select 1 from public.servicos where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.servicos where id::text like '83000000-%' and not publicado$q$),
  ($q$select 1 from public.portfolio_projetos where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.portfolio_projetos where id::text like '83000000-%' and not publicado$q$),
  ($q$select 1 from public.loteamentos where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.loteamentos where id::text like '83000000-%' and not publicado$q$),
  ($q$select 1 from public.lotes where id = '83000000-0000-0000-0000-00000000a4a1'$q$,
   $q$select 1 from public.lotes where id = '83000000-0000-0000-0000-00000000a4a2'$q$),
  ($q$select 1 from public.midias where id = '83000000-0000-0000-0000-00000000a5a1'$q$,
   $q$select 1 from public.midias where id = '83000000-0000-0000-0000-00000000a5a2'$q$),
  ($q$select 1 from public.depoimentos where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.depoimentos where id::text like '83000000-%' and not publicado$q$),
  ($q$select 1 from public.parceiros where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.parceiros where id::text like '83000000-%' and not publicado$q$),
  ($q$select 1 from public.banners_hero where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.banners_hero where id::text like '83000000-%' and not publicado$q$),
  ($q$select 1 from public.videos_instagram where id::text like '83000000-%' and publicado$q$,
   $q$select 1 from public.videos_instagram where id::text like '83000000-%' and not publicado$q$)
) as f(publicados, ocultos);

select public.t8_ve($q$select 1 from public.configuracoes_site$q$, 1, public.t8_todos());
select public.t8_ve(
  $q$select 1 from public.contatos where id::text like '83000000-%'$q$,
  2, array['admin', 'ct_v', 'ct_e']);

-- ---------------------------------------------------------------------------
-- Leitura: storage por bucket.
-- ---------------------------------------------------------------------------

select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'documentos' and name like '83000000-%'$q$,
  1, array['admin', 'dc_v', 'dc_e', 'dc_l', 'dc_el']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'site-publico' and name like '83000000-%'$q$,
  1, array['admin', 'st_v', 'st_e']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'fornecedores' and name like '83000000-%'$q$,
  1, array['admin', 'outro']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'obras' and name like 'relatos/83000000-%'$q$,
  1, array['admin']);
select public.t8_ve(
  $q$select 1 from storage.objects where bucket_id = 'obras' and name like 'atualizacoes/83000000-%'$q$,
  1, array['admin']);

-- Escrita no storage: só existe política de apagar no site-publico (site.editar). Enviar e trocar não têm política.
select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('site-publico', '83000000-0000-0000-0000-site/{u}.webp')$q$,
  array[]::text[], 'enviar arquivo ao site-publico pela sessão');
select public.t8_escreve(
  $q$update storage.objects set name = name || 'x' where bucket_id = 'site-publico' and name like '83000000-%'$q$,
  array[]::text[], 'renomear objeto do site-publico pela sessão');
select public.t8_escreve(
  $q$insert into storage.objects (bucket_id, name) values ('documentos', '83000000-0000-0000-0000-000000000e01/{u}.pdf')$q$,
  array[]::text[], 'enviar arquivo ao bucket documentos pela sessão');
select public.t8_escreve(
  $q$delete from storage.objects where bucket_id = 'documentos' and name like '83000000-%'$q$,
  array[]::text[], 'apagar objeto do bucket documentos pela sessão');
select public.t8_escreve(
  $q$delete from storage.objects where bucket_id = 'site-publico' and name = '83000000-0000-0000-0000-site/{u}.webp'$q$,
  array['admin', 'st_e'], 'apagar arquivo do site-publico',
  $q$insert into storage.objects (bucket_id, name) values ('site-publico', '83000000-0000-0000-0000-site/{u}.webp')$q$);

-- ---------------------------------------------------------------------------
-- Escrita: documentos. documentos.editar não libera para o cliente; documentos.liberar não muda o resto (R41);
-- apagar documento liberado exige editar E liberar (R12).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 documento novo', '83000000-0000-0000-0000-000000000e01/{u}.pdf', 'application/pdf', 100)$q$,
  array['admin', 'dc_e', 'dc_el'], 'enviar documento (não liberado)');
select public.t8_escreve(
  $q$insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 documento já liberado', '83000000-0000-0000-0000-000000000e01/{u}.pdf', 'application/pdf', 100, true)$q$,
  array['admin', 'dc_el'], 'enviar documento já liberado para o cliente');
select public.t8_escreve(
  $q$update public.documentos set titulo = 'T8 título {n}' where id = '83000000-0000-0000-0000-00000000d0a2'$q$,
  array['admin', 'dc_e', 'dc_el'], 'mudar título do documento');
select public.t8_escreve(
  $q$update public.documentos set liberado_cliente = true where id = '83000000-0000-0000-0000-00000000d0a2'$q$,
  array['admin', 'dc_l', 'dc_el'], 'liberar documento para o cliente',
  $q$update public.documentos set liberado_cliente = false where id = '83000000-0000-0000-0000-00000000d0a2'$q$);
-- O PostgREST manda todas as colunas no SET: liberar sem mexer em mais nada passa para quem só tem documentos.liberar.
select public.t8_escreve(
  $q$update public.documentos
        set titulo = titulo, mime = mime, tamanho = tamanho, sha256 = sha256, storage_path = storage_path,
            projeto_id = projeto_id, categoria_id = categoria_id, liberado_cliente = true
      where id = '83000000-0000-0000-0000-00000000d0a2'$q$,
  array['admin', 'dc_l', 'dc_el'], 'liberar documento com todas as colunas no SET',
  $q$update public.documentos set liberado_cliente = false where id = '83000000-0000-0000-0000-00000000d0a2'$q$);
select public.t8_escreve(
  $q$update public.documentos set liberado_cliente = false where id = '83000000-0000-0000-0000-00000000d0a1'$q$,
  array['admin', 'dc_l', 'dc_el'], 'recolher documento liberado',
  $q$update public.documentos set liberado_cliente = true where id = '83000000-0000-0000-0000-00000000d0a1'$q$);
select public.t8_escreve(
  $q$update public.documentos set titulo = 'T8 título {n}', liberado_cliente = true where id = '83000000-0000-0000-0000-00000000d0a2'$q$,
  array['admin', 'dc_el'], 'mudar título e liberar na mesma gravação',
  $q$update public.documentos set liberado_cliente = false where id = '83000000-0000-0000-0000-00000000d0a2'$q$);
select public.t8_escreve(
  $q$delete from public.documentos where id = '{u}'$q$,
  array['admin', 'dc_e', 'dc_el'], 'apagar documento não liberado',
  $q$insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 descartável', '83000000-0000-0000-0000-000000000e01/{u}.pdf', 'application/pdf', 100)$q$);
select public.t8_escreve(
  $q$delete from public.documentos where id = '{u}'$q$,
  array['admin', 'dc_el'], 'apagar documento liberado',
  $q$insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 liberado descartável', '83000000-0000-0000-0000-000000000e01/{u}.pdf', 'application/pdf', 100, true)$q$);

-- Fila "Chegaram do servidor" e revisões: documentos.liberar.
select public.t8_escreve(
  $q$select public.liberar_documento_do_servidor('83000000-0000-0000-0000-00000000d0c1')$q$,
  array['admin', 'dc_l', 'dc_el'], 'liberar documento da fila do servidor',
  $q$update public.documentos set liberado_cliente = false where id = '83000000-0000-0000-0000-00000000d0c1';
     update public.documento_origens set ignorado_em = null where documento_id = '83000000-0000-0000-0000-00000000d0c1'$q$);
select public.t8_escreve(
  $q$select public.liberar_revisao_documento('{u}')$q$,
  array['admin', 'dc_l', 'dc_el'], 'liberar revisão de documento',
  $q$insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, substitui_id)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 revisão', '83000000-0000-0000-0000-000000000e01/{u}.pdf',
             'application/pdf', 100, md5('{u}') || md5('{u}x'), '83000000-0000-0000-0000-00000000d0a2')$q$);
select public.t8_escreve(
  $q$update public.documento_origens set ignorado_em = now() where documento_id = '83000000-0000-0000-0000-00000000d0c1'$q$,
  array['admin', 'dc_l', 'dc_el'], 'ignorar origem na fila do servidor',
  $q$update public.documento_origens set ignorado_em = null where documento_id = '83000000-0000-0000-0000-00000000d0c1'$q$);
-- Origens, envios e configuração não têm política de escrita para ninguém além do que está acima (nem o admin).
select public.t8_escreve(
  $q$insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256)
     values ('83000000-0000-0000-0000-00000000d0a1', 'x/novo.pdf', 100, repeat('6', 64))$q$,
  array[]::text[], 'criar origem de documento');
select public.t8_escreve(
  $q$update public.documento_origens set caminho_relativo = 'x/outro.pdf' where documento_id = '83000000-0000-0000-0000-00000000d0c1'$q$,
  array[]::text[], 'trocar o caminho de uma origem');
select public.t8_escreve(
  $q$delete from public.documento_origens where documento_id::text like '83000000-%'$q$,
  array[]::text[], 'apagar origens');
select public.t8_escreve(
  $q$insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256)
     values ('83000000-0000-0000-0000-00000000c001', '83000000-0000-0000-0000-000000000e01', 'x/novo.pdf', 1, repeat('7', 64))$q$,
  array[]::text[], 'gravar envio do conector');
select public.t8_escreve(
  $q$delete from public.conector_envios where conector_id::text like '83000000-%'$q$,
  array[]::text[], 'apagar envios do conector');

-- ---------------------------------------------------------------------------
-- Escrita: conectores (emitir e revogar são só do admin) e a configuração geral (interruptor só do admin).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.conectores (nome, token_hash) values ('T8 conector {n}', md5('{u}') || md5('{u}x'))$q$,
  array['admin'], 'emitir conector',
  $q$update public.conectores set revogado_em = now() where revogado_em is null$q$);
select public.t8_escreve(
  $q$update public.conectores set revogado_em = now() where id = '{u}'$q$,
  array['admin'], 'revogar conector',
  $q$update public.conectores set revogado_em = now() where revogado_em is null;
     insert into public.conectores (id, nome, token_hash) values ('{u}', 'T8 ativo', md5('{u}') || md5('{u}x'))$q$);
select public.t8_escreve(
  $q$delete from public.conectores where id::text like '83000000-%'$q$,
  array[]::text[], 'apagar conector');
select public.t8_escreve(
  $q$update public.configuracoes_conector set liberacao_automatica_geral = not liberacao_automatica_geral$q$,
  array['admin'], 'mudar o interruptor geral de liberação automática');
select public.t8_escreve(
  $q$insert into public.configuracoes_conector (unica) values (true)$q$,
  array[]::text[], 'criar outra linha de configuração do conector');
select public.t8_escreve(
  $q$delete from public.configuracoes_conector$q$,
  array[]::text[], 'apagar a configuração do conector');

-- ---------------------------------------------------------------------------
-- Escrita: regras de pasta. servidor.regras gerencia as regras desligadas; ligar, alterar ou apagar regra ligada
-- é só do admin (D5, R3). A secret key (service_role) passa pelos triggers.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 REGRA {n}', 'contratos')$q$,
  array['admin', 'sr', 'sr_ed'], 'criar regra de pasta desligada');
select public.t8_escreve(
  $q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo, liberar_automatico)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 REGRA LIGADA {n}', 'contratos', true)$q$,
  array['admin'], 'criar regra de pasta já ligada');
select public.t8_escreve(
  $q$update public.pasta_regras set ativa = not ativa where id = '83000000-0000-0000-0000-00000000f0a1'$q$,
  array['admin', 'sr', 'sr_ed'], 'alterar regra de pasta desligada');
select public.t8_escreve(
  $q$update public.pasta_regras
        set caminho_prefixo = caminho_prefixo, grupo = grupo, projeto_id = projeto_id, categoria_id = categoria_id,
            ativa = ativa, liberar_automatico = liberar_automatico
      where id = '83000000-0000-0000-0000-00000000f0a1'$q$,
  array['admin', 'sr', 'sr_ed'], 'alterar regra desligada com todas as colunas no SET');
select public.t8_escreve(
  $q$update public.pasta_regras set liberar_automatico = true where id = '83000000-0000-0000-0000-00000000f0a1'$q$,
  array['admin'], 'ligar a liberação automática de uma regra',
  $q$update public.pasta_regras set liberar_automatico = false where id = '83000000-0000-0000-0000-00000000f0a1'$q$);
select public.t8_escreve(
  $q$update public.pasta_regras set ativa = not ativa where id = '83000000-0000-0000-0000-00000000f0a2'$q$,
  array['admin'], 'alterar regra de pasta ligada');
select public.t8_escreve(
  $q$update public.pasta_regras
        set caminho_prefixo = caminho_prefixo, grupo = grupo, ativa = ativa, liberar_automatico = liberar_automatico
      where id = '83000000-0000-0000-0000-00000000f0a2'$q$,
  array['admin'], 'regravar regra ligada sem mudar nada');
select public.t8_escreve(
  $q$update public.pasta_regras set liberar_automatico = false where id = '83000000-0000-0000-0000-00000000f0a2'$q$,
  array['admin'], 'desligar a liberação automática de uma regra',
  $q$update public.pasta_regras set liberar_automatico = true where id = '83000000-0000-0000-0000-00000000f0a2'$q$);
select public.t8_escreve(
  $q$delete from public.pasta_regras where id = '{u}'$q$,
  array['admin', 'sr', 'sr_ed'], 'apagar regra de pasta desligada',
  $q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 DESCARTAVEL {n}', 'contratos')$q$);
select public.t8_escreve(
  $q$delete from public.pasta_regras where id = '{u}'$q$,
  array['admin'], 'apagar regra de pasta ligada',
  $q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo, liberar_automatico)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', 'T8 DESCARTAVEL LIGADA {n}', 'contratos', true)$q$);

-- Secret key: o conector, o cron e os scripts continuam gravando essas colunas.
select public.t8_pode('servico',
  $q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo, liberar_automatico)
     values ('83000000-0000-0000-0000-00000000f0a3', '83000000-0000-0000-0000-000000000e01', 'T8 REGRA SERVICO', 'contratos', true)$q$,
  'secret key criar regra ligada');
select public.t8_pode('servico',
  $q$update public.pasta_regras set ativa = false where id = '83000000-0000-0000-0000-00000000f0a2'$q$,
  'secret key alterar regra ligada');
select public.t8_pode('servico',
  $q$delete from public.pasta_regras where id = '83000000-0000-0000-0000-00000000f0a3'$q$,
  'secret key apagar regra ligada');

-- ---------------------------------------------------------------------------
-- Escrita: empreendimentos, liberação automática e código da pasta (D5).
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.empreendimentos (id, nome) values ('{u}', 'T8 empreendimento novo {n}')$q$,
  array['admin', 'em_e', 'sr_ed'], 'criar empreendimento com a liberação automática desligada');
select public.t8_escreve(
  $q$insert into public.empreendimentos (id, nome, liberacao_automatica) values ('{u}', 'T8 empreendimento ligado {n}', true)$q$,
  array['admin'], 'criar empreendimento com a liberação automática ligada');
select public.t8_escreve(
  $q$update public.empreendimentos set liberacao_automatica = true where id = '83000000-0000-0000-0000-000000000e01'$q$,
  array['admin'], 'ligar a liberação automática do empreendimento',
  $q$update public.empreendimentos set liberacao_automatica = false where id = '83000000-0000-0000-0000-000000000e01'$q$);
select public.t8_escreve(
  $q$update public.empreendimentos set liberacao_automatica = false where id = '83000000-0000-0000-0000-000000000e02'$q$,
  array['admin'], 'desligar a liberação automática do empreendimento',
  $q$update public.empreendimentos set liberacao_automatica = true where id = '83000000-0000-0000-0000-000000000e02'$q$);
-- Com a automática LIGADA, mudar a pasta publicaria arquivos errados para o cliente: só o admin.
select public.t8_escreve(
  $q$update public.empreendimentos set codigo_pasta = '831999' where id = '83000000-0000-0000-0000-000000000e02'$q$,
  array['admin'], 'mudar o código da pasta com a liberação automática ligada',
  $q$update public.empreendimentos set codigo_pasta = '831002' where id = '83000000-0000-0000-0000-000000000e02'$q$);
select public.t8_escreve(
  $q$update public.empreendimentos set codigo_pasta = null where id = '83000000-0000-0000-0000-000000000e02'$q$,
  array['admin'], 'limpar o código da pasta com a liberação automática ligada',
  $q$update public.empreendimentos set codigo_pasta = '831002' where id = '83000000-0000-0000-0000-000000000e02'$q$);
-- Com a automática DESLIGADA, quem tem servidor.regras (e pode editar o empreendimento) muda o código da pasta.
select public.t8_pode('sr_ed',
  $q$update public.empreendimentos set codigo_pasta = '831003' where id = '83000000-0000-0000-0000-000000000e01'$q$,
  'servidor.regras mudar o código da pasta com a liberação automática desligada');
select public.t8_pode('admin',
  $q$update public.empreendimentos set codigo_pasta = '831004' where id = '83000000-0000-0000-0000-000000000e01'$q$,
  'admin mudar o código da pasta com a liberação automática desligada');
do $$
declare
  v_chave text;
begin
  foreach v_chave in array array['n0', 'dc_e', 'ps', 'st_e', 'inativa', 'pendente', 'c1', 'b1', 'f1', 'anon'] loop
    perform public.t8_nao_pode(v_chave,
      $q$update public.empreendimentos set codigo_pasta = '831005' where id = '83000000-0000-0000-0000-000000000e01'$q$,
      'mudar o código da pasta sem permissão');
  end loop;
  if (select codigo_pasta from public.empreendimentos where id = '83000000-0000-0000-0000-000000000e01') <> '831004' then
    raise exception 'FALHA: o código da pasta de A não ficou com o último valor permitido';
  end if;
end $$;
-- Editar o empreendimento sem tocar nas colunas protegidas (todas no SET, como o PostgREST faz) passa, ligado ou desligado.
select public.t8_escreve(
  $q$update public.empreendimentos
        set nome = 'T8 editado {n}', cidade = 'Cidade T8', codigo_pasta = codigo_pasta, liberacao_automatica = liberacao_automatica
      where id = '83000000-0000-0000-0000-000000000e02'$q$,
  array['admin', 'em_e', 'sr_ed'], 'editar empreendimento de liberação automática ligada sem mexer nas colunas protegidas');
select public.t8_escreve(
  $q$update public.empreendimentos
        set nome = 'T8 editado {n}', cidade = 'Cidade T8', codigo_pasta = codigo_pasta, liberacao_automatica = liberacao_automatica
      where id = '83000000-0000-0000-0000-000000000e01'$q$,
  array['admin', 'em_e', 'sr_ed'], 'editar empreendimento de liberação automática desligada sem mexer nas colunas protegidas');
select public.t8_escreve(
  $q$delete from public.empreendimentos where id = '{u}'$q$,
  array['admin'], 'apagar empreendimento',
  $q$insert into public.empreendimentos (id, nome) values ('{u}', 'T8 descartável {n}')$q$);

-- Secret key nos três lugares do interruptor.
select public.t8_pode('servico',
  $q$update public.empreendimentos set liberacao_automatica = false, codigo_pasta = '831006' where id = '83000000-0000-0000-0000-000000000e02'$q$,
  'secret key mudar liberação e código da pasta de empreendimento ligado');
select public.t8_pode('servico',
  $q$update public.empreendimentos set liberacao_automatica = true, codigo_pasta = '831007' where id = '83000000-0000-0000-0000-000000000e01'$q$,
  'secret key ligar a liberação de empreendimento');
select public.t8_pode('servico',
  $q$insert into public.empreendimentos (id, nome, liberacao_automatica, codigo_pasta)
     values ('83000000-0000-0000-0000-000000000e03', 'T8 pela secret key', true, '831008')$q$,
  'secret key criar empreendimento ligado');
select public.t8_pode('servico',
  $q$update public.configuracoes_conector set liberacao_automatica_geral = not liberacao_automatica_geral$q$,
  'secret key mudar o interruptor geral');

-- ---------------------------------------------------------------------------
-- Escrita: conteúdo do site (site.editar) e contatos (contatos.editar só marca como lido; apagar é só do admin).
-- ---------------------------------------------------------------------------

select public.t8_escreve(f.ins, array['admin', 'st_e'], 'criar ' || f.t),
       public.t8_escreve(f.upd, array['admin', 'st_e'], 'editar ' || f.t),
       public.t8_escreve(f.del, array['admin', 'st_e'], 'apagar ' || f.t, f.prep)
from (values
  ('servicos',
   $q$insert into public.servicos (id, titulo, slug) values ('{u}', 'T8 serviço', 't8-serv-{n}')$q$,
   $q$update public.servicos set resumo = 'T8' where id = '83000000-0000-0000-0000-00000000a1a1'$q$,
   $q$delete from public.servicos where id = '{u}'$q$,
   $q$insert into public.servicos (id, titulo, slug) values ('{u}', 'T8 descartável', 't8-serv-d{n}')$q$),
  ('portfolio_projetos',
   $q$insert into public.portfolio_projetos (id, titulo, slug) values ('{u}', 'T8 portfólio', 't8-port-{n}')$q$,
   $q$update public.portfolio_projetos set descricao = 'T8' where id = '83000000-0000-0000-0000-00000000a2a1'$q$,
   $q$delete from public.portfolio_projetos where id = '{u}'$q$,
   $q$insert into public.portfolio_projetos (id, titulo, slug) values ('{u}', 'T8 descartável', 't8-port-d{n}')$q$),
  ('loteamentos',
   $q$insert into public.loteamentos (id, nome, slug) values ('{u}', 'T8 loteamento', 't8-lot-{n}')$q$,
   $q$update public.loteamentos set descricao = 'T8' where id = '83000000-0000-0000-0000-00000000a3a1'$q$,
   $q$delete from public.loteamentos where id = '{u}'$q$,
   $q$insert into public.loteamentos (id, nome, slug) values ('{u}', 'T8 descartável', 't8-lot-d{n}')$q$),
  ('lotes',
   $q$insert into public.lotes (id, loteamento_id, quadra, numero) values ('{u}', '83000000-0000-0000-0000-00000000a3a1', 'N{n}', '1')$q$,
   $q$update public.lotes set observacao = 'T8' where id = '83000000-0000-0000-0000-00000000a4a1'$q$,
   $q$delete from public.lotes where id = '{u}'$q$,
   $q$insert into public.lotes (id, loteamento_id, quadra, numero) values ('{u}', '83000000-0000-0000-0000-00000000a3a1', 'D{n}', '1')$q$),
  ('midias',
   $q$insert into public.midias (id, tipo, storage_path, loteamento_id)
      values ('{u}', 'foto', 'loteamentos/83000000-0000-0000-0000-00000000a3a1/n{n}.webp', '83000000-0000-0000-0000-00000000a3a1')$q$,
   $q$update public.midias set legenda = 'T8' where id = '83000000-0000-0000-0000-00000000a5a1'$q$,
   $q$delete from public.midias where id = '{u}'$q$,
   $q$insert into public.midias (id, tipo, storage_path, loteamento_id)
      values ('{u}', 'foto', 'loteamentos/83000000-0000-0000-0000-00000000a3a1/d{n}.webp', '83000000-0000-0000-0000-00000000a3a1')$q$),
  ('depoimentos',
   $q$insert into public.depoimentos (id, nome, texto) values ('{u}', 'T8 depoimento', 'Texto')$q$,
   $q$update public.depoimentos set cidade = 'T8' where id = '83000000-0000-0000-0000-00000000a6a1'$q$,
   $q$delete from public.depoimentos where id = '{u}'$q$,
   $q$insert into public.depoimentos (id, nome, texto) values ('{u}', 'T8 descartável', 'Texto')$q$),
  ('parceiros',
   $q$insert into public.parceiros (id, nome, logo_path) values ('{u}', 'T8 parceiro', 'parceiros/t8-{n}.webp')$q$,
   $q$update public.parceiros set site_url = 'https://t8.example' where id = '83000000-0000-0000-0000-00000000a7a1'$q$,
   $q$delete from public.parceiros where id = '{u}'$q$,
   $q$insert into public.parceiros (id, nome, logo_path) values ('{u}', 'T8 descartável', 'parceiros/t8-d{n}.webp')$q$),
  ('banners_hero',
   $q$insert into public.banners_hero (id, sobrancelha, titulo, texto, imagem_path) values ('{u}', 'T8', 'T8 banner', 'Texto', 'hero/t8-{n}.webp')$q$,
   $q$update public.banners_hero set legenda = 'T8' where id = '83000000-0000-0000-0000-00000000a8a1'$q$,
   $q$delete from public.banners_hero where id = '{u}'$q$,
   $q$insert into public.banners_hero (id, sobrancelha, titulo, texto, imagem_path) values ('{u}', 'T8', 'T8 descartável', 'Texto', 'hero/t8-d{n}.webp')$q$),
  ('videos_instagram',
   $q$insert into public.videos_instagram (id, video_path) values ('{u}', 'instagram/t8-{n}.mp4')$q$,
   $q$update public.videos_instagram set legenda = 'T8' where id = '83000000-0000-0000-0000-00000000a9a1'$q$,
   $q$delete from public.videos_instagram where id = '{u}'$q$,
   $q$insert into public.videos_instagram (id, video_path) values ('{u}', 'instagram/t8-d{n}.mp4')$q$)
) as f(t, ins, upd, del, prep);

select public.t8_escreve(
  $q$update public.configuracoes_site set sobre_titulo = 'T8 {n}'$q$,
  array['admin', 'st_e'], 'editar as configurações do site');
select public.t8_escreve(
  $q$insert into public.configuracoes_site (unico) values (true)$q$,
  array[]::text[], 'criar outra linha de configurações do site');
select public.t8_escreve(
  $q$delete from public.configuracoes_site$q$,
  array[]::text[], 'apagar as configurações do site');

select public.t8_escreve(
  $q$update public.contatos set lido = not lido where id = '83000000-0000-0000-0000-00000000aaa1'$q$,
  array['admin', 'ct_e'], 'marcar contato como lido');
select public.t8_escreve(
  $q$update public.contatos set mensagem = 'T8 adulterada' where id = '83000000-0000-0000-0000-00000000aaa2'$q$,
  array[]::text[], 'alterar a mensagem de um contato');
select public.t8_escreve(
  $q$insert into public.contatos (id, nome, mensagem) values ('{u}', 'T8', 'Mensagem')$q$,
  array[]::text[], 'criar contato pela sessão');
select public.t8_escreve(
  $q$delete from public.contatos where id = '{u}'$q$,
  array['admin'], 'apagar contato',
  $q$insert into public.contatos (id, nome, mensagem) values ('{u}', 'T8 descartável', 'Mensagem')$q$);

-- ---------------------------------------------------------------------------
-- Integração com os triggers validar_vinculos_portal (leem projetos e categorias sob o RLS de quem grava).
-- Ficam por último: se a migration deixar quem só tem documentos.editar sem enxergar/travar o projeto, é aqui que aparece.
-- ---------------------------------------------------------------------------

select public.t8_escreve(
  $q$insert into public.documentos (id, empreendimento_id, projeto_id, categoria_id, titulo, storage_path, mime, tamanho)
     values ('{u}', '83000000-0000-0000-0000-000000000e01', '83000000-0000-0000-0000-00000000a001',
             '83000000-0000-0000-0000-00000000a0b1', 'T8 documento do projeto', '83000000-0000-0000-0000-000000000e01/{u}.pdf', 'application/pdf', 100)$q$,
  array['admin', 'dc_e', 'dc_el'], 'enviar documento ligado a projeto e categoria (validar_vinculos_portal)');
select public.t8_escreve(
  $q$update public.documentos set projeto_id = '83000000-0000-0000-0000-00000000a001', categoria_id = '83000000-0000-0000-0000-00000000a0b1'
      where id = '83000000-0000-0000-0000-00000000d0a2'$q$,
  array['admin', 'dc_e', 'dc_el'], 'reclassificar documento em projeto e categoria (validar_vinculos_portal)',
  $q$update public.documentos set projeto_id = null, categoria_id = null where id = '83000000-0000-0000-0000-00000000d0a2'$q$);

-- Depois de toda a matriz, a fixture continua inteira.
do $$
begin
  if (select count(*) from public.documentos where id in (
        '83000000-0000-0000-0000-00000000d0a1', '83000000-0000-0000-0000-00000000d0a2', '83000000-0000-0000-0000-00000000d0b1',
        '83000000-0000-0000-0000-00000000d0c1', '83000000-0000-0000-0000-00000000d0c2')) <> 5 then
    raise exception 'FALHA: a matriz apagou documento da fixture';
  end if;
  if (select count(*) from public.pasta_regras where id in (
        '83000000-0000-0000-0000-00000000f0a1', '83000000-0000-0000-0000-00000000f0a2')) <> 2 then
    raise exception 'FALHA: a matriz apagou regra de pasta da fixture';
  end if;
  if (select count(*) from public.empreendimentos where id in (
        '83000000-0000-0000-0000-000000000e01', '83000000-0000-0000-0000-000000000e02')) <> 2 then
    raise exception 'FALHA: a matriz apagou empreendimento da fixture';
  end if;
end $$;

select 'OK: documentos, servidor e site da Etapa 8 passaram na matriz de RLS' as resultado;

rollback;
