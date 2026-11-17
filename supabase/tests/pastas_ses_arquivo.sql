-- Testes do catálogo de pastas com SES, Básico da EEE e pastas de arquivo (docs/PASTAS-SES-ARQUIVO-CONTRATO.md; migration
-- 20261113100000_pastas_ses_arquivo.sql): forma do catálogo, itens novos, grupo 'arquivo' em pasta_regras e documentos,
-- montar_empreendimento_de_pastas, confirmar_envio_conector e a leitura do cliente.
-- Como rodar (somente em banco de TESTE ou com o ROLLBACK do fim), depois de TODAS as migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pastas_ses_arquivo.sql
--   (ou npx.cmd supabase db query --linked -f supabase/tests/pastas_ses_arquivo.sql)
-- Rode com o usuário postgres. Tudo acontece numa transação que termina em ROLLBACK. Se alguma verificação falhar, o script
-- para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O teste revoga o conector ativo e cria o próprio (o banco só admite um ativo); tudo volta no ROLLBACK. Se o modelo de um
-- item novo (ses, basico_ees, per_ses) não existir no banco, o teste cria um modelo mínimo e liga o item, só na transação.
--
-- Fixture (ids 94000000-0000-0000-0000-..., montados por public.tmp_u):
--   contas: d1 admin; d2 equipe com empreendimentos.ver + editar + servidor.regras; d5 cliente do empreendimento E1
--   empreendimentos: E1 (e001, código 929292, complementares ligados, montado pelo teste), E2 (e002, código 929293,
--                    complementares desligados), E3 (e003, sem código, para inserir regras e documentos à mão) e
--                    E4 (e004, código 929294, complementares ligados, só a pasta do SES, sem projeto)

begin;

-- ---------------------------------------------------------------------------
-- Ajudantes (existem só dentro da transação)
-- ---------------------------------------------------------------------------

create function public.tmp_exige_ok(p_sql text, p_msg text)
returns void language plpgsql as $$
begin
  execute p_sql;
exception when others then
  raise exception 'FALHA: % (erro %: %)', p_msg, sqlstate, sqlerrm;
end;
$$;

create function public.tmp_exige_erro(p_sql text, p_estados text[], p_msg text)
returns void language plpgsql as $$
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

create function public.tmp_exige_conta(p_sql text, p_esperado bigint, p_msg text)
returns void language plpgsql as $$
declare
  v_conta bigint;
begin
  execute p_sql into v_conta;
  if v_conta is distinct from p_esperado then
    raise exception 'FALHA: % (contou %, esperado %)', p_msg, v_conta, p_esperado;
  end if;
end;
$$;

create function public.tmp_exige_texto(p_sql text, p_esperado text, p_msg text)
returns void language plpgsql as $$
declare
  v_texto text;
begin
  execute p_sql into v_texto;
  if v_texto is distinct from p_esperado then
    raise exception 'FALHA: % (veio "%", esperado "%")', p_msg, coalesce(v_texto, '(nulo)'), coalesce(p_esperado, '(nulo)');
  end if;
end;
$$;

create function public.tmp_exige_verdade(p_sql text, p_msg text)
returns void language plpgsql as $$
declare
  v_ok boolean;
begin
  execute p_sql into v_ok;
  if v_ok is not true then
    raise exception 'FALHA: %', p_msg;
  end if;
end;
$$;

create function public.tmp_u(p text)
returns uuid language sql immutable as $$
  select ('94000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid
$$;

create function public.tmp_doc(p_n int)
returns uuid language sql immutable as $$
  select ('94000000-0000-0000-0001-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create function public.tmp_nome(p_chave text)
returns text language sql stable as $$
  select c.nome_projeto from public.catalogo_pastas c where c.chave = p_chave
$$;

-- Troca quem está executando: 'postgres' ou d1..d6 (authenticated com o sub da conta).
create function public.tmp_como(p_quem text)
returns void language plpgsql as $$
begin
  execute 'reset role';
  if p_quem = 'postgres' then
    perform set_config('request.jwt.claims', '{}', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', public.tmp_u(p_quem), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end;
$$;

-- Documento direto no banco (empreendimento E3), para testar os CHECKs de grupo e pasta_rotulo.
create function public.tmp_inserir_doc(p_n int, p_grupo text, p_rotulo text, p_projeto uuid default null)
returns void language plpgsql as $$
begin
  insert into public.documentos (id, empreendimento_id, projeto_id, grupo, pasta_rotulo, titulo, storage_path, mime, tamanho)
  values (public.tmp_doc(p_n), public.tmp_u('e003'), p_projeto, p_grupo, p_rotulo, 'Doc ' || p_n,
          public.tmp_u('e003')::text || '/' || public.tmp_doc(p_n)::text || '.pdf', 'application/pdf', 100);
end;
$$;

-- Regra direto no banco (empreendimento E3).
create function public.tmp_inserir_regra(p_caminho text, p_grupo text, p_rotulo text, p_projeto uuid default null)
returns void language plpgsql as $$
begin
  insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id, grupo, rotulo)
  values (public.tmp_u('e003'), p_caminho, 'comum', p_projeto, p_grupo, p_rotulo);
end;
$$;

-- Chegada de um PDF numa regra: envio autorizado como o POST /envios deixa, e a confirmação pelo caminho do conector.
create function public.tmp_chega(p_n int, p_regra uuid)
returns jsonb language plpgsql as $$
declare
  v_emp uuid;
  v_prefixo text;
  v_doc uuid := public.tmp_doc(p_n);
  v_envio uuid;
begin
  select r.empreendimento_id, r.caminho_prefixo into v_emp, v_prefixo from public.pasta_regras r where r.id = p_regra;
  insert into public.conector_envios (conector_id, empreendimento_id, regra_id, caminho_relativo, tamanho, sha256, estado,
                                      storage_path, documento_planejado_id, mtime)
  values (public.tmp_u('0c01'), v_emp, p_regra, v_prefixo || '/arquivo ' || p_n || '.pdf', 100, lpad(p_n::text, 64, '0'),
          'autorizado', v_emp::text || '/' || v_doc::text || '.pdf', v_doc, now())
  returning id into v_envio;
  return public.confirmar_envio_conector(v_envio, public.tmp_u('0c01'), 'Arquivo ' || p_n, null, now(), null, null);
end;
$$;

create function public.tmp_montar(p_emp uuid, p_itens jsonb)
returns jsonb language sql as $$
  select public.montar_empreendimento_de_pastas(p_emp, p_itens);
$$;

grant execute on function
  public.tmp_exige_ok(text, text), public.tmp_exige_erro(text, text[], text), public.tmp_exige_conta(text, bigint, text),
  public.tmp_exige_texto(text, text, text), public.tmp_exige_verdade(text, text), public.tmp_u(text), public.tmp_doc(int),
  public.tmp_nome(text), public.tmp_como(text), public.tmp_inserir_doc(int, text, text, uuid),
  public.tmp_inserir_regra(text, text, text, uuid), public.tmp_montar(uuid, jsonb)
  to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. Catálogo: itens novos e itens alterados (antes de qualquer ajuste do teste)
-- ---------------------------------------------------------------------------

select public.tmp_exige_verdade(
  $q$select (select count(*) from public.catalogo_pastas where chave in ('per_ses', 'pec_ses', 'dt_ses', 'basico_ees', 'urbanistico',
       'rede_aerea', 'telemetria', 'drenagem', 'terraplanagem', 'motobomba', 'executivos')) = 11$q$,
  'os 11 itens novos existem no catálogo');

select public.tmp_exige_verdade(
  $q$select c.tipo = 'projeto' and c.fase = 'complementar' and c.raiz = '03 - PRODUTOS' and c.termos = array['PER', 'SES']
       and c.termos_excluir = array['PEC'] and c.depende_de = 'ses' and c.categoria = 'Projetos' and c.cria_regras
       and c.subpastas = '[[["APROVAD*"]]]'::jsonb and c.ordem = 45
       and c.nome_projeto = 'Elevatória de Esgoto Bruto - PER - SES' and c.rotulo = 'Projeto Elétrico Referência (PER) - SES'
     from public.catalogo_pastas c where c.chave = 'per_ses'$q$,
  'per_ses: PER + SES, exclui PEC, depende do ses, subpasta APROVAD*');
select public.tmp_exige_verdade(
  $q$select c.termos = array['PEC', 'SES'] and c.termos_excluir = array[]::text[] and c.depende_de = 'ses' and c.ordem = 55
       and c.nome_projeto = 'Elevatória de Esgoto Bruto - PEC - SES' and c.fase = 'complementar'
     from public.catalogo_pastas c where c.chave = 'pec_ses'$q$,
  'pec_ses: PEC + SES');
select public.tmp_exige_verdade(
  $q$select c.termos = array['DESCRICAO', 'TOPOGRAFICA', 'SES'] and c.depende_de = 'ses' and c.ordem = 35
       and c.nome_projeto = 'Descrição Topográfica Faixas de Servidão - SES' and c.fase = 'complementar'
     from public.catalogo_pastas c where c.chave = 'dt_ses'$q$,
  'dt_ses: DESCRICAO + TOPOGRAFICA + SES');
select public.tmp_exige_verdade(
  $q$select b.tipo = 'projeto' and b.fase = 'complementar' and b.termos = array['SES'] and b.termos_excluir = s.termos_excluir
       and b.depende_de = 'ses' and not b.cria_regras and b.subpastas = '[]'::jsonb and b.categoria is null and b.ordem = 25
       and b.nome_projeto = 'Básico da Elevatória de Esgoto - SES'
     from public.catalogo_pastas b, public.catalogo_pastas s where b.chave = 'basico_ees' and s.chave = 'ses'$q$,
  'basico_ees: mesmos termos do ses, sem regras, dentro da pasta do SES');
select public.tmp_exige_conta(
  $q$select count(*) from public.catalogo_pastas where chave in ('per_ses', 'pec_ses', 'dt_ses') and (modelo_id is null) = ativo$q$,
  0, 'item novo sem modelo nasce inativo e com modelo, ativo');

select public.tmp_exige_conta(
  $q$select count(*) from public.catalogo_pastas where tipo = 'arquivo' and fase = 'base' and raiz = '03 - PRODUTOS'
       and subpastas = '[]'::jsonb and ativo and modelo_id is null and nome_projeto is null and categoria is null and grupo is null
       and depende_de is null and destino_equipamentos is null and cria_regras$q$,
  7, 'sete itens de arquivo, ativos e sem modelo');
select public.tmp_exige_texto(
  $q$select string_agg(c.chave || ':' || array_to_string(c.termos, ','), ' ' order by c.ordem) from public.catalogo_pastas c where c.tipo = 'arquivo'$q$,
  'urbanistico:URBANISTICO rede_aerea:REDE,AEREA telemetria:TELEMETRIA|RADIO drenagem:DRENAGEM terraplanagem:TERRAPLANAGEM|TERRAPLENAGEM motobomba:MOTOBOMBA executivos:EXECUTIVO*',
  'termos dos itens de arquivo');
select public.tmp_exige_texto(
  $q$select string_agg(c.chave || ':' || c.rotulo, ' | ' order by c.ordem) from public.catalogo_pastas c where c.tipo = 'arquivo'$q$,
  'urbanistico:Projeto Urbanístico | rede_aerea:Projeto de Rede Aérea | telemetria:Projeto de Telemetria e Rádio | drenagem:Projeto de Drenagem Pluvial | terraplanagem:Projeto de Terraplanagem | motobomba:Conjunto Motobomba | executivos:Projetos Executivos',
  'rótulos dos itens de arquivo (nome do cartão do cliente)');

select public.tmp_exige_conta(
  $q$select count(*) from public.catalogo_pastas where chave in ('per', 'pec', 'dt') and 'SES' = any (termos_excluir)$q$,
  3, 'per, pec e dt excluem SES');
select public.tmp_exige_verdade(
  $q$select 'PEC' = any (termos_excluir) from public.catalogo_pastas where chave = 'per'$q$, 'per continua excluindo PEC');

select public.tmp_exige_verdade(
  $q$select e.modelo_id is not null and r.modelo_id is not null and e.modelo_id <> r.modelo_id
       and m.nome = 'Projeto Estrutural da Elevatória'
     from public.catalogo_pastas e
     join public.catalogo_pastas r on r.chave = 'estrutural_reservatorio'
     join public.modelos_etapas m on m.id = e.modelo_id
     where e.chave = 'estrutural_elevatoria'$q$,
  'estrutural_elevatoria aponta para o modelo próprio');
select public.tmp_exige_conta(
  $q$select count(*) from (
       (select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i
         where i.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_elevatoria')
        except select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i
         where i.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_reservatorio'))
       union all
       (select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i
         where i.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_reservatorio')
        except select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i
         where i.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_elevatoria'))
     ) d$q$,
  0, 'o modelo da elevatória tem as mesmas etapas e marcos do reservatório');
select public.tmp_exige_conta(
  $q$select count(*) from (
       (select c.nome, c.ordem from public.modelo_categorias_documento c
         where c.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_elevatoria')
        except select c.nome, c.ordem from public.modelo_categorias_documento c
         where c.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_reservatorio'))
       union all
       (select c.nome, c.ordem from public.modelo_categorias_documento c
         where c.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_reservatorio')
        except select c.nome, c.ordem from public.modelo_categorias_documento c
         where c.modelo_id = (select modelo_id from public.catalogo_pastas where chave = 'estrutural_elevatoria'))
     ) d$q$,
  0, 'o modelo da elevatória tem as mesmas categorias do reservatório');

-- ---------------------------------------------------------------------------
-- 2. Fixture
-- ---------------------------------------------------------------------------

-- Modelo mínimo para os itens que a montagem usa, caso o banco de teste não tenha os modelos "... - SES".
do $$
declare
  v_chave text;
  v_nome text;
  v_modelo uuid;
begin
  foreach v_chave in array array['ses', 'basico_ees', 'per_ses'] loop
    select c.nome_projeto, c.modelo_id into v_nome, v_modelo from public.catalogo_pastas c where c.chave = v_chave;
    if not found then
      raise exception 'FALHA: o item % não existe no catálogo', v_chave;
    end if;
    if v_modelo is null then
      select m.id into v_modelo from public.modelos_etapas m where m.nome = v_nome;
      if v_modelo is null then
        insert into public.modelos_etapas (nome) values (v_nome) returning id into v_modelo;
        insert into public.modelo_etapas_itens (modelo_id, nome, ordem) values (v_modelo, 'Não Iniciado', 1);
        insert into public.modelo_categorias_documento (modelo_id, nome, ordem) values (v_modelo, 'Projetos', 1);
      end if;
      update public.catalogo_pastas set modelo_id = v_modelo where chave = v_chave;
    end if;
    update public.catalogo_pastas set ativo = true where chave = v_chave;
  end loop;
end;
$$;

update public.conectores set revogado_em = now() where revogado_em is null;
insert into public.conectores (id, nome, token_hash, arvore)
values (public.tmp_u('0c01'), 'Conector teste pastas SES', repeat('c', 64), jsonb_build_object(
  '929292', jsonb_build_array(
    '02 - FINANCEIRO',
    '02 - FINANCEIRO/01 - PROPOSTA E CONTRATO',
    '03 - PRODUTOS',
    '03 - PRODUTOS/03 - P. - SES',
    '03 - PRODUTOS/03 - P. - SES/02 - LAN',
    '03 - PRODUTOS/03 - P. - SES/02 - LAN/01 - APROVADO',
    '03 - PRODUTOS/07 - PER - SES',
    '03 - PRODUTOS/07 - PER - SES/01 - APROVADO',
    '03 - PRODUTOS/09 - URBANISTICO'
  ),
  '929293', jsonb_build_array(
    '03 - PRODUTOS',
    '03 - PRODUTOS/07 - PER - SES',
    '03 - PRODUTOS/07 - PER - SES/01 - APROVADO'
  ),
  '929294', jsonb_build_array(
    '03 - PRODUTOS',
    '03 - PRODUTOS/03 - P. - SES'
  )
));

insert into auth.users (id, aud, role, email)
values
  (public.tmp_u('d1'), 'authenticated', 'authenticated', 'pastas-ses-admin@example.com'),
  (public.tmp_u('d2'), 'authenticated', 'authenticated', 'pastas-ses-equipe@example.com'),
  (public.tmp_u('d5'), 'authenticated', 'authenticated', 'pastas-ses-cliente@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  (public.tmp_u('d1'), 'admin', 'Admin Pastas SES', true, false),
  (public.tmp_u('d2'), 'equipe', 'Equipe Pastas SES', true, false),
  (public.tmp_u('d5'), 'cliente', 'Cliente Pastas SES', true, false);

insert into public.equipe_permissoes (profile_id, permissao)
values (public.tmp_u('d2'), 'empreendimentos.ver');
insert into public.equipe_permissoes (profile_id, permissao)
values
  (public.tmp_u('d2'), 'empreendimentos.editar'),
  (public.tmp_u('d2'), 'servidor.regras');

insert into public.empreendimentos (id, nome, cidade, codigo_pasta, ler_complementares)
values
  (public.tmp_u('e001'), 'Empreendimento Pastas SES 1', 'Cidade', '929292', true),
  (public.tmp_u('e002'), 'Empreendimento Pastas SES 2', 'Cidade', '929293', false),
  (public.tmp_u('e004'), 'Empreendimento Pastas SES 4', 'Cidade', '929294', true);
insert into public.empreendimentos (id, nome, cidade)
values (public.tmp_u('e003'), 'Empreendimento Pastas SES 3', 'Cidade');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values (public.tmp_u('e001'), public.tmp_u('d5'));

-- Itens usados na montagem. O Básico vem primeiro de propósito: a função tem de criar o SES antes dele. Os nomes dos
-- projetos são os do catálogo. O Básico manda um caminho que existe: como o item não cria regras, ele é descartado.
create temporary table tmp_itens (nome text primary key, itens jsonb not null) on commit drop;
grant select on tmp_itens to authenticated, anon;
insert into tmp_itens values
  ('base', jsonb_build_array(
     jsonb_build_object('chave', 'basico_ees', 'caminhos', jsonb_build_array('03 - PRODUTOS/03 - P. - SES'),
                        'projeto_pai_chave', 'ses', 'nome_projeto', public.tmp_nome('basico_ees')),
     jsonb_build_object('chave', 'urbanistico', 'caminhos', jsonb_build_array('03 - PRODUTOS/09 - URBANISTICO'),
                        'projeto_pai_chave', null::text, 'nome_projeto', null::text),
     jsonb_build_object('chave', 'ses', 'caminhos', jsonb_build_array('03 - PRODUTOS/03 - P. - SES/02 - LAN/01 - APROVADO'),
                        'projeto_pai_chave', null::text, 'nome_projeto', public.tmp_nome('ses'))
   )),
  ('per_ses', jsonb_build_array(
     jsonb_build_object('chave', 'per_ses', 'caminhos', jsonb_build_array('03 - PRODUTOS/07 - PER - SES/01 - APROVADO'),
                        'projeto_pai_chave', 'ses', 'nome_projeto', public.tmp_nome('per_ses'))
   )),
  ('so_basico', jsonb_build_array(
     jsonb_build_object('chave', 'basico_ees', 'caminhos', jsonb_build_array(),
                        'projeto_pai_chave', 'ses', 'nome_projeto', public.tmp_nome('basico_ees'))
   )),
  ('basico_sem_caminho', jsonb_build_array(
     jsonb_build_object('chave', 'basico_ees', 'caminhos', jsonb_build_array(),
                        'projeto_pai_chave', 'ses', 'nome_projeto', public.tmp_nome('basico_ees')),
     jsonb_build_object('chave', 'ses', 'caminhos', jsonb_build_array('03 - PRODUTOS/03 - P. - SES/02 - LAN/01 - APROVADO'),
                        'projeto_pai_chave', null::text, 'nome_projeto', public.tmp_nome('ses'))
   )),
  ('arquivo_fora', jsonb_build_array(
     jsonb_build_object('chave', 'drenagem', 'caminhos', jsonb_build_array('03 - PRODUTOS/99 - INVENTADA'),
                        'projeto_pai_chave', null::text, 'nome_projeto', null::text)
   ));

-- ---------------------------------------------------------------------------
-- 3. catalogo_pastas: forma e cria_regras
-- ---------------------------------------------------------------------------

select public.tmp_exige_ok(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas)
     values ('teste_arquivo_ok', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]')$q$,
  'item de arquivo sem modelo, projeto, categoria, grupo e dependência é aceito');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, modelo_id)
     values ('teste_arquivo_1', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', (select id from public.modelos_etapas limit 1))$q$,
  array['23514'], 'arquivo com modelo é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, nome_projeto)
     values ('teste_arquivo_2', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', 'Projeto')$q$,
  array['23514'], 'arquivo com nome de projeto é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, categoria)
     values ('teste_arquivo_3', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', 'Projetos')$q$,
  array['23514'], 'arquivo com categoria é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, grupo)
     values ('teste_arquivo_4', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', 'contratos')$q$,
  array['23514'], 'arquivo com grupo é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, depende_de)
     values ('teste_arquivo_5', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', 'ses')$q$,
  array['23514'], 'arquivo com dependência é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, destino_equipamentos)
     values ('teste_arquivo_6', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', 'os')$q$,
  array['23514'], 'arquivo com destino de equipamentos é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas)
     values ('teste_arquivo_7', 'Teste', '03 - PRODUTOS', array['TESTE'], 'complementar', 'arquivo', '[]')$q$,
  array['23514'], 'arquivo só existe na fase base');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas)
     values ('teste_tipo_1', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'outro', '[]')$q$,
  array['23514'], 'tipo desconhecido é recusado');

select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, grupo, cria_regras)
     values ('teste_regras_1', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'grupo', '[]', 'contratos', false)$q$,
  array['23514'], 'cria_regras false em grupo é recusado');
select public.tmp_exige_erro(
  $q$insert into public.catalogo_pastas (chave, rotulo, raiz, termos, fase, tipo, subpastas, cria_regras)
     values ('teste_regras_2', 'Teste', '03 - PRODUTOS', array['TESTE'], 'base', 'arquivo', '[]', false)$q$,
  array['23514'], 'cria_regras false em arquivo é recusado');
select public.tmp_exige_erro(
  $q$update public.catalogo_pastas set cria_regras = false where chave = 'simos'$q$,
  array['23514'], 'cria_regras false em equipamentos é recusado');
select public.tmp_exige_ok(
  $q$update public.catalogo_pastas set cria_regras = false where chave = 'saa'$q$,
  'cria_regras false em projeto é aceito');
select public.tmp_exige_ok(
  $q$update public.catalogo_pastas set cria_regras = true where chave = 'saa'$q$, 'cria_regras volta a true');

-- ---------------------------------------------------------------------------
-- 4. pasta_regras e documentos: grupo 'arquivo' exige rótulo (empreendimento E3)
-- ---------------------------------------------------------------------------

select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/arquivo-sem-rotulo', 'arquivo', null)$q$, array['23514'], 'regra arquivo sem rótulo é recusada');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/contratos-com-rotulo', 'contratos', 'Contratos')$q$, array['23514'], 'regra de contratos com rótulo é recusada');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/orcamentos-com-rotulo', 'orcamentos', 'Orçamentos')$q$, array['23514'], 'regra de orçamentos com rótulo é recusada');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/rotulo-vazio', 'arquivo', '')$q$, array['23514'], 'rótulo vazio é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/rotulo-espacos', 'arquivo', '   ')$q$, array['23514'], 'rótulo só com espaços é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/rotulo-controle', 'arquivo', E'a\tb')$q$, array['23514'], 'rótulo com caractere de controle é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/rotulo-longo', 'arquivo', repeat('x', 121))$q$, array['23514'], 'rótulo com 121 caracteres é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/grupo-invalido', 'outro', 'Rótulo')$q$, array['23514'], 'grupo desconhecido é recusado');
select public.tmp_exige_ok($q$select public.tmp_inserir_regra('T/rotulo-120', 'arquivo', repeat('x', 120))$q$, 'rótulo com 120 caracteres é aceito');
select public.tmp_exige_ok($q$select public.tmp_inserir_regra('T/arquivo-ok', 'arquivo', 'Projeto de Teste')$q$, 'regra arquivo com rótulo é aceita');
select public.tmp_exige_ok($q$select public.tmp_inserir_regra('T/contratos-ok', 'contratos', null)$q$, 'regra de contratos sem rótulo continua aceita');
select public.tmp_exige_erro(
  $q$update public.pasta_regras set rotulo = null where empreendimento_id = public.tmp_u('e003') and caminho_prefixo = 'T/arquivo-ok'$q$,
  array['23514'], 'apagar o rótulo de uma regra arquivo é recusado');
select public.tmp_exige_erro(
  $q$update public.pasta_regras set grupo = 'contratos' where empreendimento_id = public.tmp_u('e003') and caminho_prefixo = 'T/arquivo-ok'$q$,
  array['23514'], 'trocar o grupo arquivo sem tirar o rótulo é recusado');

select public.tmp_exige_erro($q$select public.tmp_inserir_doc(1, 'arquivo', null)$q$, array['23514'], 'documento arquivo sem rótulo é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(2, 'contratos', 'Contratos')$q$, array['23514'], 'documento de contratos com rótulo é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(3, null, 'Solto')$q$, array['23514'], 'documento sem grupo com rótulo é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(4, 'arquivo', '')$q$, array['23514'], 'documento com rótulo vazio é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(5, 'arquivo', E'a\nb')$q$, array['23514'], 'documento com rótulo com controle é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(6, 'arquivo', repeat('x', 121))$q$, array['23514'], 'documento com rótulo de 121 caracteres é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(7, 'outro', null)$q$, array['23514'], 'documento com grupo desconhecido é recusado');
select public.tmp_exige_ok($q$select public.tmp_inserir_doc(8, 'arquivo', 'Projeto de Teste')$q$, 'documento arquivo com rótulo é aceito');
select public.tmp_exige_ok($q$select public.tmp_inserir_doc(9, 'contratos', null)$q$, 'documento de contratos sem rótulo continua aceito');
select public.tmp_exige_ok($q$select public.tmp_inserir_doc(10, 'orcamentos', null)$q$, 'documento de orçamentos sem rótulo continua aceito');
select public.tmp_exige_erro(
  $q$update public.documentos set pasta_rotulo = null where id = public.tmp_doc(8)$q$,
  array['23514'], 'apagar o rótulo de um documento arquivo é recusado');

-- ---------------------------------------------------------------------------
-- 5. Montagem: arquivo vira regra oculta com rótulo; o Básico nasce sem regra
-- ---------------------------------------------------------------------------

select public.tmp_como('d2');

select public.tmp_exige_erro($q$select public.tmp_montar(public.tmp_u('e001'), (select itens from tmp_itens where nome = 'arquivo_fora'))$q$,
  array['P0001'], 'caminho de arquivo fora da árvore é recusado');
select public.tmp_exige_erro($q$select public.tmp_montar(public.tmp_u('e004'), (select itens from tmp_itens where nome = 'so_basico'))$q$,
  array['P0001'], 'Básico sem o SES no empreendimento é recusado');
select public.tmp_exige_conta($q$select count(*) from public.projetos where empreendimento_id = public.tmp_u('e004')$q$, 0,
  'o Básico recusado não deixa projeto');
select public.tmp_exige_ok($q$select public.tmp_montar(public.tmp_u('e001'), (select itens from tmp_itens where nome = 'base'))$q$,
  'montagem com Básico (listado antes do SES), arquivo e SES');

select public.tmp_como('postgres');

select public.tmp_exige_conta($q$select count(*) from public.projetos where empreendimento_id = public.tmp_u('e001')$q$, 2, 'a base cria o SES e o Básico (arquivo não vira projeto)');
select public.tmp_exige_conta($q$select count(*) from public.projetos b join public.projetos s on s.id = b.projeto_pai_id
  where b.empreendimento_id = public.tmp_u('e001') and b.nome = public.tmp_nome('basico_ees') and s.nome = public.tmp_nome('ses')$q$,
  1, 'o Básico da EEE depende do SES');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = public.tmp_u('e001')$q$, 2,
  'só o SES e o arquivo ganham regra (o Básico não)');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras r join public.projetos p on p.id = r.projeto_id
  where r.empreendimento_id = public.tmp_u('e001') and p.nome = public.tmp_nome('basico_ees')$q$,
  0, 'o Básico nasce sem regra');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = public.tmp_u('e001')
  and caminho_prefixo = '03 - PRODUTOS/03 - P. - SES'$q$,
  0, 'o caminho mandado para o Básico foi descartado');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras r join public.projetos p on p.id = r.projeto_id
  where r.empreendimento_id = public.tmp_u('e001') and p.nome = public.tmp_nome('ses') and r.tipo = 'comum' and r.grupo is null
    and r.caminho_prefixo = '03 - PRODUTOS/03 - P. - SES/02 - LAN/01 - APROVADO'$q$,
  1, 'o SES continua com a regra de projeto');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = public.tmp_u('e001')
  and caminho_prefixo = '03 - PRODUTOS/09 - URBANISTICO' and tipo = 'comum' and grupo = 'arquivo' and rotulo = 'Projeto Urbanístico'
  and projeto_id is null and categoria_id is null and not liberar_automatico and ativa and sinal is null$q$,
  1, 'o arquivo vira regra comum de grupo arquivo, oculta, com o rótulo do catálogo');

select public.tmp_como('d2');
select public.tmp_exige_ok($q$select public.tmp_montar(public.tmp_u('e001'), (select itens from tmp_itens where nome = 'basico_sem_caminho'))$q$,
  'segunda montagem roda');
select public.tmp_como('postgres');
select public.tmp_exige_conta($q$select count(*) from public.projetos where empreendimento_id = public.tmp_u('e001')$q$, 2, 'segunda montagem não duplica projetos');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = public.tmp_u('e001')$q$, 2, 'segunda montagem não duplica regras');

-- Complementar do lado SES: exige a chave (E2 está com ela desligada) e depende do SES.
select public.tmp_como('d2');
select public.tmp_exige_erro($q$select public.tmp_montar(public.tmp_u('e002'), (select itens from tmp_itens where nome = 'per_ses'))$q$,
  array['P0001'], 'PER do SES sem ler_complementares é recusado');
select public.tmp_exige_ok($q$select public.tmp_montar(public.tmp_u('e001'), (select itens from tmp_itens where nome = 'per_ses'))$q$, 'PER do SES entra com os complementares ligados');
select public.tmp_como('postgres');
select public.tmp_exige_conta($q$select count(*) from public.projetos f join public.projetos p on p.id = f.projeto_pai_id
  where f.empreendimento_id = public.tmp_u('e001') and f.nome = public.tmp_nome('per_ses') and p.nome = public.tmp_nome('ses')$q$,
  1, 'o PER do SES depende do SES');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras r join public.projetos p on p.id = r.projeto_id
  where r.empreendimento_id = public.tmp_u('e001') and p.nome = public.tmp_nome('per_ses')
    and r.caminho_prefixo = '03 - PRODUTOS/07 - PER - SES/01 - APROVADO' and r.tipo = 'comum'$q$,
  1, 'o PER do SES ganha a regra da pasta APROVADO');

-- Com um projeto do E3 (o do trigger validar_pasta_regra, para o erro não vir da troca de empreendimento): rótulo em
-- regra ou documento de projeto é recusado, e a regra e o documento de projeto sem rótulo continuam aceitos.
insert into public.projetos (id, empreendimento_id, nome) values (public.tmp_u('b003'), public.tmp_u('e003'), 'Projeto E3');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/projeto-com-rotulo', null, 'Rótulo', public.tmp_u('b003'))$q$,
  array['23514'], 'regra de projeto com rótulo é recusada');
select public.tmp_exige_erro($q$select public.tmp_inserir_regra('T/arquivo-com-projeto', 'arquivo', 'Rótulo', public.tmp_u('b003'))$q$,
  array['23514'], 'regra arquivo com projeto é recusada');
select public.tmp_exige_ok($q$select public.tmp_inserir_regra('T/projeto-ok', null, null, public.tmp_u('b003'))$q$, 'regra de projeto sem rótulo continua aceita');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(11, 'arquivo', 'Rótulo', public.tmp_u('b003'))$q$,
  array['23514'], 'documento arquivo com projeto é recusado');
select public.tmp_exige_erro($q$select public.tmp_inserir_doc(12, null, 'Rótulo', public.tmp_u('b003'))$q$,
  array['23514'], 'documento de projeto com rótulo é recusado');
select public.tmp_exige_ok($q$select public.tmp_inserir_doc(13, null, null, public.tmp_u('b003'))$q$, 'documento de projeto sem grupo nem rótulo continua aceito');

-- ---------------------------------------------------------------------------
-- 6. confirmar_envio_conector grava pasta_rotulo; o cliente só lê o documento arquivo liberado
-- ---------------------------------------------------------------------------

select public.tmp_exige_ok($q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, tipo, grupo)
  values (public.tmp_u('f002'), public.tmp_u('e001'), '02 - FINANCEIRO/01 - PROPOSTA E CONTRATO', 'comum', 'contratos')$q$,
  'regra de contratos do E1');

select public.tmp_exige_texto(
  $q$select (public.tmp_chega(21, (select id from public.pasta_regras where empreendimento_id = public.tmp_u('e001') and grupo = 'arquivo')))->>'situacao'$q$,
  'confirmado', 'o PDF da pasta de arquivo é confirmado');
select public.tmp_exige_texto(
  $q$select (public.tmp_chega(22, public.tmp_u('f002')))->>'situacao'$q$, 'confirmado', 'o PDF de contratos é confirmado');
select public.tmp_exige_texto(
  $q$select (public.tmp_chega(23, (select r.id from public.pasta_regras r join public.projetos p on p.id = r.projeto_id
       where r.empreendimento_id = public.tmp_u('e001') and p.nome = public.tmp_nome('ses'))))->>'situacao'$q$,
  'confirmado', 'o PDF do SES é confirmado');

select public.tmp_exige_conta($q$select count(*) from public.documentos where id = public.tmp_doc(21) and grupo = 'arquivo'
  and pasta_rotulo = 'Projeto Urbanístico' and projeto_id is null and categoria_id is null and not liberado_cliente$q$,
  1, 'o documento da pasta de arquivo grava o rótulo da regra e chega oculto');
select public.tmp_exige_conta($q$select count(*) from public.documentos where id = public.tmp_doc(22) and grupo = 'contratos'
  and pasta_rotulo is null and projeto_id is null$q$,
  1, 'o documento de contratos não tem rótulo');
select public.tmp_exige_conta($q$select count(*) from public.documentos where id = public.tmp_doc(23) and grupo is null
  and pasta_rotulo is null and projeto_id is not null$q$,
  1, 'o documento de projeto não tem grupo nem rótulo');

select public.tmp_como('d5');
select public.tmp_exige_conta($q$select count(*) from public.documentos where empreendimento_id = public.tmp_u('e001')$q$, 0, 'o cliente não vê documento oculto');

select public.tmp_como('postgres');
update public.documentos set liberado_cliente = true where id = public.tmp_doc(21);

select public.tmp_como('d5');
select public.tmp_exige_conta($q$select count(*) from public.documentos where id = public.tmp_doc(21) and pasta_rotulo = 'Projeto Urbanístico'$q$, 1, 'o cliente lê o documento arquivo liberado, com o rótulo');
select public.tmp_exige_conta($q$select count(*) from public.documentos where empreendimento_id = public.tmp_u('e001')$q$, 1, 'o cliente só vê o documento liberado');
select public.tmp_exige_conta($q$select count(*) from public.documentos where id = public.tmp_doc(22)$q$, 0, 'o cliente não vê o contrato oculto');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = public.tmp_u('e001')$q$, 0, 'o cliente não lê as regras de pasta');

select public.tmp_como('postgres');

select public.tmp_exige_erro($q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, grupo, rotulo, liberar_automatico)
  values (public.tmp_u('e003'), '03 - PRODUTOS/98 - ARQUIVO LIBERADO', 'comum', 'arquivo', 'Teste', true)$q$,
  array['23514'], 'regra de arquivo nunca libera sozinha');

select 'OK' as resultado;

rollback;
