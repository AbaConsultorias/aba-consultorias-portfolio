-- Testes das etapas automáticas pelas pastas (docs/ETAPAS-AUTOMATICAS-CONTRATO.md; migration 20261112100000_etapas_automaticas.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapas_automaticas.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapas_automaticas.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece numa transação que termina em ROLLBACK. Se alguma
-- verificação falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
-- O teste revoga o conector ativo e cria o próprio (o banco só admite um ativo); tudo volta no ROLLBACK.
--
-- Fixture (ids 93000000-0000-0000-0000-..., montados por public.tmp_u):
--   contas: d1 admin; d2 equipe com empreendimentos.ver + editar; d3 equipe só com ver; d4 equipe sem permissão;
--           d5 cliente do empreendimento E1; d6 fornecedor
--   empreendimentos: E1 (e001) e E2 (e002)
--   projetos (b0NN; etapas c0NN1..): 01 SAA-like (5 etapas), 02 Termo-like (sem confecção), 03 Doação (sem marco),
--           06 recalcular e 08 atômico (SAA-like) e 0f "Projeto Falha E1", todos em E1;
--           04 automático, 07 pendente e 05 "Projeto Falha E2", em E2
--   regras de cada projeto NN: f0NN1 protocolos, f0NN2 devolutivas, f0NN3 comum com sinal aprovado
--   datas dos arquivos: public.tmp_t(dias) = 200 dias atrás + dias, ao meio-dia

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

create function public.tmp_exige_negado(p_sql text, p_msg text)
returns void language plpgsql as $$
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

create function public.tmp_exige_maior(p_sql text, p_minimo bigint, p_msg text)
returns void language plpgsql as $$
declare
  v_conta bigint;
begin
  execute p_sql into v_conta;
  if v_conta is null or v_conta < p_minimo then
    raise exception 'FALHA: % (contou %, mínimo %)', p_msg, v_conta, p_minimo;
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
  select ('93000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid
$$;

create function public.tmp_p(p_code text)
returns uuid language sql immutable as $$
  select public.tmp_u('b0' || p_code)
$$;

create function public.tmp_e(p_code text, p_ordem int)
returns uuid language sql immutable as $$
  select public.tmp_u('c' || p_code || p_ordem)
$$;

create function public.tmp_doc(p_n int)
returns uuid language sql immutable as $$
  select ('93000000-0000-0000-0001-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create function public.tmp_t(p_dias int)
returns timestamptz language sql stable as $$
  select date_trunc('day', now()) - interval '200 days' + p_dias * interval '1 day' + interval '12 hours'
$$;

create function public.tmp_sinal(p_n int)
returns uuid language sql stable as $$
  select s.id from public.etapa_sinais s where s.documento_id = public.tmp_doc(p_n)
$$;

-- Registro de histórico (não 'desfazer') que o sinal do arquivo p_n gerou.
create function public.tmp_hist(p_n int)
returns uuid language sql stable as $$
  select h.id from public.projeto_etapa_historico h
   where h.sinal_id = public.tmp_sinal(p_n) and h.origem <> 'desfazer'
   order by h.em desc limit 1
$$;

-- Troca quem está executando: 'postgres', 'anon' ou d1..d6 (authenticated com o sub da conta).
create function public.tmp_como(p_quem text)
returns void language plpgsql as $$
begin
  execute 'reset role';
  if p_quem = 'postgres' then
    perform set_config('request.jwt.claims', '{}', true);
  elsif p_quem = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', public.tmp_u(p_quem), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
end;
$$;

-- Projeto com as etapas do tipo (marco preenchido pelo nome, como o backfill) e a primeira como etapa atual.
create function public.tmp_novo_projeto(p_emp uuid, p_code text, p_nome text, p_tipo text)
returns void language plpgsql as $$
declare
  v_projeto uuid := public.tmp_p(p_code);
  v_nomes text[];
begin
  v_nomes := case p_tipo
    when 'saa' then array['Não Iniciado', 'Em Confecção', 'Em Análise da Copasa', 'Aprovado', 'Doações finalizadas']
    when 'termo' then array['Não Iniciado', 'Em análise da Copasa', 'Aprovado, obras em andamento']
    else array['Não Iniciado', 'Confeccionando ITCD, DAE e Início das doações']
  end;
  insert into public.projetos (id, empreendimento_id, nome) values (v_projeto, p_emp, p_nome);
  insert into public.projeto_etapas (id, projeto_id, nome, ordem, marco)
  select public.tmp_e(p_code, n.ordem::int), v_projeto, n.nome, n.ordem::int, public.marco_da_etapa_por_nome(n.nome)
  from unnest(v_nomes) with ordinality as n(nome, ordem);
  update public.projetos set etapa_atual_id = public.tmp_e(p_code, 1) where id = v_projeto;
end;
$$;

create function public.tmp_regras(p_emp uuid, p_code text, p_prefixo text)
returns void language plpgsql as $$
begin
  insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id)
  values
    (public.tmp_u('f' || p_code || '1'), p_emp, p_prefixo || '/PROJETOS', 'protocolos', 'protocolo', public.tmp_p(p_code)),
    (public.tmp_u('f' || p_code || '2'), p_emp, p_prefixo || '/LAN', 'devolutivas', 'devolutiva', public.tmp_p(p_code)),
    (public.tmp_u('f' || p_code || '3'), p_emp, p_prefixo || '/LAN/01 - APROVADO NO INTERLIGA', 'comum', 'aprovado', public.tmp_p(p_code));
end;
$$;

-- Chegada de um PDF: envio autorizado como o POST /envios deixa, e a confirmação pelo caminho do conector.
create function public.tmp_chega(p_n int, p_regra uuid, p_mtime timestamptz)
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
          'autorizado', v_emp::text || '/' || v_doc::text || '.pdf', v_doc, p_mtime)
  returning id into v_envio;
  return public.confirmar_envio_conector(v_envio, public.tmp_u('0c01'), 'Arquivo ' || p_n, null, now(), null, null);
end;
$$;

grant execute on function
  public.tmp_exige_ok(text, text), public.tmp_exige_erro(text, text[], text), public.tmp_exige_negado(text, text),
  public.tmp_exige_conta(text, bigint, text), public.tmp_exige_maior(text, bigint, text),
  public.tmp_exige_texto(text, text, text), public.tmp_exige_verdade(text, text),
  public.tmp_u(text), public.tmp_p(text), public.tmp_e(text, int), public.tmp_doc(int), public.tmp_t(int),
  public.tmp_sinal(int), public.tmp_hist(int), public.tmp_como(text)
  to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

update public.conectores set revogado_em = now() where revogado_em is null;
insert into public.conectores (id, nome, token_hash)
values (public.tmp_u('0c01'), 'Conector teste etapas automáticas', repeat('b', 64));

insert into auth.users (id, aud, role, email)
values
  (public.tmp_u('d1'), 'authenticated', 'authenticated', 'etapas-admin@example.com'),
  (public.tmp_u('d2'), 'authenticated', 'authenticated', 'etapas-editor@example.com'),
  (public.tmp_u('d3'), 'authenticated', 'authenticated', 'etapas-so-ver@example.com'),
  (public.tmp_u('d4'), 'authenticated', 'authenticated', 'etapas-sem-permissao@example.com'),
  (public.tmp_u('d5'), 'authenticated', 'authenticated', 'etapas-cliente@example.com'),
  (public.tmp_u('d6'), 'authenticated', 'authenticated', 'etapas-fornecedor@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  (public.tmp_u('d1'), 'admin', 'Admin Etapas', true, false),
  (public.tmp_u('d2'), 'equipe', 'Editor Etapas', true, false),
  (public.tmp_u('d3'), 'equipe', 'Só Ver Etapas', true, false),
  (public.tmp_u('d4'), 'equipe', 'Sem Permissão Etapas', true, false),
  (public.tmp_u('d5'), 'cliente', 'Cliente Etapas', true, false),
  (public.tmp_u('d6'), 'fornecedor', 'Fornecedor Etapas', true, false);

insert into public.equipe_permissoes (profile_id, permissao)
values
  (public.tmp_u('d2'), 'empreendimentos.ver'),
  (public.tmp_u('d3'), 'empreendimentos.ver');
insert into public.equipe_permissoes (profile_id, permissao)
values (public.tmp_u('d2'), 'empreendimentos.editar');

insert into public.empreendimentos (id, nome, codigo_pasta)
values
  (public.tmp_u('e001'), 'Empreendimento Etapas Um', '939301'),
  (public.tmp_u('e002'), 'Empreendimento Etapas Dois', '939302');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values (public.tmp_u('e001'), public.tmp_u('d5'));

select public.tmp_novo_projeto(public.tmp_u('e001'), '01', 'Projeto SAA Teste', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e001'), '02', 'Projeto Termo Teste', 'termo');
select public.tmp_novo_projeto(public.tmp_u('e001'), '03', 'Projeto Doação Teste', 'doacao');
select public.tmp_novo_projeto(public.tmp_u('e001'), '06', 'Projeto Recálculo Teste', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e001'), '08', 'Projeto Atômico Teste', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e001'), '0f', 'Projeto Falha E1', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e002'), '04', 'Projeto Automático Teste', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e002'), '05', 'Projeto Falha E2', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e002'), '07', 'Projeto Pendente E2', 'saa');

select public.tmp_regras(public.tmp_u('e001'), '01', 'T93/01');
select public.tmp_regras(public.tmp_u('e001'), '02', 'T93/02');
select public.tmp_regras(public.tmp_u('e001'), '03', 'T93/03');
select public.tmp_regras(public.tmp_u('e001'), '06', 'T93/06');
select public.tmp_regras(public.tmp_u('e001'), '08', 'T93/08');
select public.tmp_regras(public.tmp_u('e001'), '0f', 'T93/0F');
select public.tmp_regras(public.tmp_u('e002'), '04', 'T93/04');
select public.tmp_regras(public.tmp_u('e002'), '05', 'T93/05');
select public.tmp_regras(public.tmp_u('e002'), '07', 'T93/07');

-- Regra comum sem sinal, para conferir que só regra com sinal gera sinal.
insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, projeto_id)
values (public.tmp_u('f049'), public.tmp_u('e002'), 'T93/04/OUTROS', public.tmp_p('04'));

-- A atribuição inicial da primeira etapa (etapa_atual_id nulo -> primeira) não é mudança de etapa.
select public.tmp_exige_conta(
  $q$select count(*) from public.projeto_etapa_historico where projeto_id in (select id from public.projetos where empreendimento_id in (public.tmp_u('e001'), public.tmp_u('e002')))$q$,
  0, 'a etapa inicial do projeto novo não entra no histórico');

-- Projeto cujo nome começa com "Projeto Falha" quebra ao mudar de etapa: serve para provar o isolamento do automático
-- e o "tudo ou nada" do recálculo. Criado só depois dos projetos para não quebrar a fixture.
create function public.tmp_falha_etapa()
returns trigger language plpgsql as $$
begin
  if new.nome like 'Projeto Falha%' then
    raise exception 'falha de teste' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger tmp_falha_etapa
  before update of etapa_atual_id on public.projetos
  for each row execute function public.tmp_falha_etapa();

-- ---------------------------------------------------------------------------
-- 1. Marcos das etapas
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('Em Confecção', 'confeccao'),
      ('em confecção', 'confeccao'),
      ('Em confecção', 'confeccao'),
      ('Em Análise da Copasa', 'analise'),
      ('Em análise', 'analise'),
      ('  Em Analise da Copasa  ', 'analise'),
      ('Aprovado', 'aprovado'),
      ('APROVADO', 'aprovado'),
      ('Aprovado, obras em andamento', 'aprovado'),
      ('Confeccionando ITCD, DAE e Início das doações', null),
      ('Doações finalizadas', null),
      ('Obras e vistorias finalizadas', null),
      ('Não Iniciado', null),
      ('Aprovado em parte', null),
      ('Reprovado', null),
      ('Aguardando aprovado', null),
      (null, null)
    ) as v(nome, esperado)
  loop
    if public.marco_da_etapa_por_nome(r.nome) is distinct from r.esperado then
      raise exception 'FALHA: marco de "%" devia ser % e veio %', r.nome, coalesce(r.esperado, '(nenhum)'),
        coalesce(public.marco_da_etapa_por_nome(r.nome), '(nenhum)');
    end if;
  end loop;
end
$$;

select public.tmp_exige_texto(
  $q$select string_agg(coalesce(marco, '-'), ',' order by ordem) from public.projeto_etapas where projeto_id = public.tmp_p('01')$q$,
  '-,confeccao,analise,aprovado,-', 'etapas do SAA recebem os marcos pelo nome');
select public.tmp_exige_texto(
  $q$select string_agg(coalesce(marco, '-'), ',' order by ordem) from public.projeto_etapas where projeto_id = public.tmp_p('02')$q$,
  '-,analise,aprovado', 'Termo/OS: sem confecção, "Aprovado, obras em andamento" é aprovado');
select public.tmp_exige_texto(
  $q$select string_agg(coalesce(marco, '-'), ',' order by ordem) from public.projeto_etapas where projeto_id = public.tmp_p('03')$q$,
  '-,-', 'Doação: "Confeccionando ITCD..." não vira confecção');

select public.tmp_exige_erro(
  $q$insert into public.projeto_etapas (projeto_id, nome, ordem, marco) values (public.tmp_p('01'), 'Aprovado de novo', 20, 'aprovado')$q$,
  array['23505'], 'dois marcos iguais no mesmo projeto são recusados');
select public.tmp_exige_erro(
  $q$update public.projeto_etapas set marco = 'analise' where id = public.tmp_e('01', 2)$q$,
  array['23505'], 'trocar o marco para um que já existe no projeto é recusado');
select public.tmp_exige_erro(
  $q$insert into public.projeto_etapas (projeto_id, nome, ordem, marco) values (public.tmp_p('01'), 'Marco inventado', 21, 'qualquer')$q$,
  array['23514'], 'marco fora da lista é recusado');
select public.tmp_exige_ok(
  $q$insert into public.projeto_etapas (projeto_id, nome, ordem) values (public.tmp_p('01'), 'Sem marco A', 22), (public.tmp_p('01'), 'Sem marco B', 23)$q$,
  'várias etapas sem marco no mesmo projeto são permitidas');
select public.tmp_exige_ok(
  $q$insert into public.projeto_etapas (projeto_id, nome, ordem, marco) values (public.tmp_p('02'), 'Em Confecção', 20, 'confeccao')$q$,
  'o mesmo marco em outro projeto é permitido');
delete from public.projeto_etapas where projeto_id in (public.tmp_p('01'), public.tmp_p('02')) and ordem >= 20;

insert into public.modelos_etapas (id, nome, descricao, ativo)
values (public.tmp_u('aa01'), 'Modelo Teste Etapas Automáticas', null, true);
insert into public.modelo_etapas_itens (id, modelo_id, nome, ordem, marco)
select public.tmp_u('ab' || n.ordem), public.tmp_u('aa01'), n.nome, n.ordem::int, public.marco_da_etapa_por_nome(n.nome)
from unnest(array['Não Iniciado', 'Em Confecção', 'Em Análise da Copasa', 'Aprovado']) with ordinality as n(nome, ordem);

select public.tmp_exige_erro(
  $q$insert into public.modelo_etapas_itens (modelo_id, nome, ordem, marco) values (public.tmp_u('aa01'), 'Outra aprovada', 9, 'aprovado')$q$,
  array['23505'], 'dois marcos iguais no mesmo modelo são recusados');
select public.tmp_exige_erro(
  $q$insert into public.modelo_etapas_itens (modelo_id, nome, ordem, marco) values (public.tmp_u('aa01'), 'Marco inventado', 9, 'qualquer')$q$,
  array['23514'], 'marco de modelo fora da lista é recusado');

-- criar_projeto_de_modelo copia o marco; salvar_etapas_projeto_portal preserva o das etapas existentes e a nova não tem.
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.criar_projeto_de_modelo(public.tmp_u('e001'), public.tmp_u('aa01'), 'Projeto do Modelo Teste', null)$q$,
  'criar projeto a partir do modelo');
select public.tmp_exige_texto(
  $q$select string_agg(coalesce(e.marco, '-'), ',' order by e.ordem) from public.projeto_etapas e join public.projetos p on p.id = e.projeto_id where p.nome = 'Projeto do Modelo Teste' and p.empreendimento_id = public.tmp_u('e001')$q$,
  '-,confeccao,analise,aprovado', 'o projeto novo copia os marcos do modelo');
select public.tmp_exige_conta(
  $q$select count(*) from public.projeto_etapa_historico h join public.projetos p on p.id = h.projeto_id where p.nome = 'Projeto do Modelo Teste' and p.empreendimento_id = public.tmp_u('e001')$q$,
  0, 'projeto criado do modelo não tem histórico');

select public.tmp_exige_ok(
  $q$select public.salvar_etapas_projeto_portal(
       p.id, p.etapa_atual_id,
       (select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.nome || ' (renomeada)', 'ordem', e.ordem) order by e.ordem)
               || jsonb_build_array(jsonb_build_object('nome', 'Etapa nova', 'ordem', 9))
          from public.projeto_etapas e where e.projeto_id = p.id),
       '[]'::jsonb)
     from public.projetos p
     where p.nome = 'Projeto do Modelo Teste' and p.empreendimento_id = public.tmp_u('e001')$q$,
  'salvar etapas do projeto renomeando e criando etapa');
select public.tmp_exige_texto(
  $q$select string_agg(coalesce(e.marco, '-'), ',' order by e.ordem) from public.projeto_etapas e join public.projetos p on p.id = e.projeto_id where p.nome = 'Projeto do Modelo Teste' and p.empreendimento_id = public.tmp_u('e001')$q$,
  '-,confeccao,analise,aprovado,-', 'salvar preserva o marco das etapas existentes e a etapa nova entra sem marco');
select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.projeto_etapas e join public.projetos p on p.id = e.projeto_id where p.nome = 'Projeto do Modelo Teste' and e.nome = 'Em Confecção (renomeada)' and e.marco = 'confeccao')$q$,
  'a etapa renomeada continua com o marco');
select public.tmp_como('postgres');

-- ---------------------------------------------------------------------------
-- 2. pasta_regras: tipos, sinal e restrições
-- ---------------------------------------------------------------------------

select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id) values (public.tmp_u('e001'), 'X/1', 'protocolos', public.tmp_p('01'))$q$,
  array['23514'], 'protocolos sem sinal');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id) values (public.tmp_u('e001'), 'X/2', 'protocolos', 'devolutiva', public.tmp_p('01'))$q$,
  array['23514'], 'protocolos com sinal de devolutiva');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id) values (public.tmp_u('e001'), 'X/3', 'comum', 'protocolo', public.tmp_p('01'))$q$,
  array['23514'], 'regra comum com sinal de protocolo');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id) values (public.tmp_u('e001'), 'X/4', 'devolutivas', 'aprovado', public.tmp_p('01'))$q$,
  array['23514'], 'devolutivas com sinal aprovado');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id) values (public.tmp_u('e001'), 'X/5', 'devolutivas', null, public.tmp_p('01'))$q$,
  array['23514'], 'devolutivas sem sinal');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, grupo) values (public.tmp_u('e001'), 'X/6', 'protocolos', 'protocolo', 'contratos')$q$,
  array['23514'], 'protocolos exige projeto e não aceita grupo');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id, grupo) values (public.tmp_u('e001'), 'X/7', 'devolutivas', 'devolutiva', public.tmp_p('01'), 'contratos')$q$,
  array['23514'], 'devolutivas com projeto e grupo');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, grupo) values (public.tmp_u('e001'), 'X/8', 'comum', 'aprovado', 'contratos')$q$,
  array['23514'], 'sinal aprovado exige projeto');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id) values (public.tmp_u('e001'), 'X/9', 'comum', 'qualquer', public.tmp_p('01'))$q$,
  array['23514'], 'sinal fora da lista');
select public.tmp_exige_erro(
  $q$insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id) values (public.tmp_u('e001'), 'X/10', 'outro', public.tmp_p('01'))$q$,
  array['23514'], 'tipo fora da lista');
select public.tmp_exige_erro(
  $q$update public.pasta_regras set sinal = 'protocolo' where id = public.tmp_u('f013')$q$,
  array['23514'], 'regra comum não vira sinal de protocolo');
select public.tmp_exige_erro(
  $q$update public.pasta_regras set tipo = 'devolutivas' where id = public.tmp_u('f013')$q$,
  array['23514'], 'trocar o tipo sem trocar o sinal é recusado');

insert into public.projeto_categorias_documento (id, projeto_id, nome, ordem)
values (public.tmp_u('ca01'), public.tmp_p('01'), 'Protocolos', 90);
select public.tmp_exige_ok(
  $q$insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, tipo, sinal, projeto_id, categoria_id) values (public.tmp_u('f0ca'), public.tmp_u('e001'), 'T93/01/PROJETOS/COM CATEGORIA', 'protocolos', 'protocolo', public.tmp_p('01'), public.tmp_u('ca01'))$q$,
  'protocolos aceita categoria do projeto');
select public.tmp_exige_ok(
  $q$update public.pasta_regras set ativa = false where id = public.tmp_u('f0ca')$q$,
  'desativar regra de protocolos');
delete from public.pasta_regras where id = public.tmp_u('f0ca');

-- Preenchimento do sinal 'aprovado' nas regras existentes: o mesmo UPDATE da migration, só nas regras desta fixture.
insert into public.pasta_regras (empreendimento_id, caminho_prefixo, projeto_id, ativa)
values
  (public.tmp_u('e001'), 'T93/BF/03 - ORDEM DE SERVIÇO - APROVADA', public.tmp_p('01'), true),
  (public.tmp_u('e001'), 'T93/BF/PROJETOS', public.tmp_p('01'), true),
  (public.tmp_u('e001'), 'T93/BF/Aprovação', public.tmp_p('01'), true),
  (public.tmp_u('e001'), 'T93/BF/APROVADO INATIVA', public.tmp_p('01'), false),
  (public.tmp_u('e001'), 'T93/BF/APROVADO SEM MARCO', public.tmp_p('03'), true),
  (public.tmp_u('e001'), 'T93/BF/LAN/01 - Aprovado no Interliga', public.tmp_p('01'), true);

update public.pasta_regras r
set sinal = 'aprovado'
where r.caminho_prefixo like 'T93/BF/%'
  and r.ativa
  and r.tipo = 'comum'
  and r.projeto_id is not null
  and exists (
    select 1
    from unnest(string_to_array(r.caminho_prefixo, '/')) as s(segmento)
    where upper(regexp_replace(normalize(s.segmento, nfd), '[̀-ͯ]', '', 'g')) like '%APROVAD%'
  )
  and exists (
    select 1 from public.projeto_etapas e where e.projeto_id = r.projeto_id and e.marco = 'aprovado'
  );

select public.tmp_exige_texto(
  $q$select string_agg(caminho_prefixo, ' | ' order by caminho_prefixo) from public.pasta_regras where caminho_prefixo like 'T93/BF/%' and sinal = 'aprovado'$q$,
  'T93/BF/03 - ORDEM DE SERVIÇO - APROVADA | T93/BF/LAN/01 - Aprovado no Interliga',
  'o preenchimento marca só regra ativa de projeto com etapa aprovado e APROVAD (sem acento) num trecho do caminho');

delete from public.pasta_regras where caminho_prefixo like 'T93/BF/%';

-- ---------------------------------------------------------------------------
-- 3. Modo por empreendimento
-- ---------------------------------------------------------------------------

select public.tmp_exige_texto(
  $q$select etapas_modo from public.empreendimentos where id = public.tmp_u('e001')$q$, 'desligado', 'o modo padrão é desligado');
select public.tmp_exige_erro(
  $q$update public.empreendimentos set etapas_modo = 'qualquer' where id = public.tmp_u('e001')$q$,
  array['23514'], 'modo fora da lista');

select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$update public.empreendimentos set etapas_modo = 'sugerir' where id = public.tmp_u('e001')$q$,
  'quem edita empreendimentos liga o modo sugerir');
select public.tmp_exige_erro(
  $q$update public.empreendimentos set etapas_modo = 'automatico' where id = public.tmp_u('e001')$q$,
  array['42501'], 'não-admin não liga o automático');
select public.tmp_exige_erro(
  $q$insert into public.empreendimentos (nome, etapas_modo) values ('Empreendimento Automático Teste', 'automatico')$q$,
  array['42501'], 'não-admin não cria empreendimento já em automático');
select public.tmp_como('d3');
select public.tmp_exige_negado(
  $q$update public.empreendimentos set etapas_modo = 'sugerir' where id = public.tmp_u('e001')$q$,
  'só ver não muda o modo');

select public.tmp_como('d1');
select public.tmp_exige_ok(
  $q$update public.empreendimentos set etapas_modo = 'automatico' where id = public.tmp_u('e001')$q$,
  'admin liga o automático');
select public.tmp_exige_texto(
  $q$select etapas_modo from public.empreendimentos where id = public.tmp_u('e001')$q$, 'automatico', 'o automático ficou ligado');

select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$update public.empreendimentos set etapas_modo = 'sugerir' where id = public.tmp_u('e001')$q$,
  array['42501'], 'não-admin não tira do automático');
select public.tmp_exige_ok(
  $q$update public.empreendimentos set cidade = 'Cidade Teste' where id = public.tmp_u('e001')$q$,
  'estando em automático, mudar outro campo não pede admin');

select public.tmp_como('d1');
select public.tmp_exige_ok(
  $q$update public.empreendimentos set etapas_modo = 'sugerir' where id = public.tmp_u('e001')$q$,
  'admin volta para sugerir');

-- Sem usuário (secret key, script): passa. E2 fica em desligado até a seção do automático.
select public.tmp_como('postgres');
select public.tmp_exige_ok(
  $q$update public.empreendimentos set etapas_modo = 'automatico' where id = public.tmp_u('e002')$q$,
  'chamada sem usuário muda o modo');
select public.tmp_exige_ok(
  $q$update public.empreendimentos set etapas_modo = 'desligado' where id = public.tmp_u('e002')$q$,
  'chamada sem usuário desliga o modo');

-- ---------------------------------------------------------------------------
-- 4. Sinais: confirmar_envio_conector, RLS e escrita direta
-- ---------------------------------------------------------------------------

select public.tmp_exige_texto(
  $q$select public.tmp_chega(1, public.tmp_u('f011'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo (1) confirma');
select public.tmp_exige_verdade(
  $q$select exists (
       select 1 from public.etapa_sinais s
        where s.id = public.tmp_sinal(1) and s.tipo = 'protocolo' and s.projeto_id = public.tmp_p('01')
          and s.empreendimento_id = public.tmp_u('e001') and s.data_arquivo = public.tmp_t(10)
          and s.aplicado_em is null and s.ignorado_em is null)$q$,
  'a regra de protocolos grava o sinal com a data do arquivo');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('01', 1) from public.projetos where id = public.tmp_p('01')$q$,
  'no modo sugerir a etapa não avança');
select public.tmp_exige_conta(
  $q$select count(*) from public.projeto_etapa_historico where projeto_id = public.tmp_p('01')$q$, 0, 'sem mudança, sem histórico');

-- Confirmar de novo é idempotente e não duplica o sinal.
select public.tmp_exige_texto(
  $q$select (public.confirmar_envio_conector(
       (select id from public.conector_envios where documento_planejado_id = public.tmp_doc(1)),
       public.tmp_u('0c01'), 'x', null, now(), null, null)->>'novo')$q$,
  'false', 'repetir a confirmação não cria nada');
select public.tmp_exige_conta(
  $q$select count(*) from public.etapa_sinais where documento_id = public.tmp_doc(1)$q$, 1, 'um sinal por documento');

-- Quem lê: equipe com empreendimentos.ver; os demais não.
select public.tmp_como('d3');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where empreendimento_id = public.tmp_u('e001')$q$, 1, 'só ver lê os sinais');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('01'))$q$, 1, 'só ver lê a sugestão');
select public.tmp_como('d2');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where empreendimento_id = public.tmp_u('e001')$q$, 1, 'editor lê os sinais');
select public.tmp_como('d1');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where empreendimento_id = public.tmp_u('e001')$q$, 1, 'admin lê os sinais');

select public.tmp_como('d4');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais$q$, 0, 'equipe sem empreendimentos.ver não lê sinais');
select public.tmp_exige_conta($q$select count(*) from public.projeto_etapa_historico$q$, 0, 'equipe sem empreendimentos.ver não lê histórico');
select public.tmp_exige_erro($q$select * from public.sugestao_etapa(public.tmp_p('01'))$q$, array['42501'], 'equipe sem empreendimentos.ver não pede sugestão');

select public.tmp_como('d5');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais$q$, 0, 'cliente não lê sinais');
select public.tmp_exige_conta($q$select count(*) from public.projeto_etapa_historico$q$, 0, 'cliente não lê histórico');
select public.tmp_exige_erro($q$select * from public.sugestao_etapa(public.tmp_p('01'))$q$, array['42501'], 'cliente não pede sugestão');

select public.tmp_como('d6');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais$q$, 0, 'fornecedor não lê sinais');
select public.tmp_exige_conta($q$select count(*) from public.projeto_etapa_historico$q$, 0, 'fornecedor não lê histórico');
select public.tmp_exige_erro($q$select * from public.sugestao_etapa(public.tmp_p('01'))$q$, array['42501'], 'fornecedor não pede sugestão');

select public.tmp_como('anon');
select public.tmp_exige_erro($q$select count(*) from public.etapa_sinais$q$, array['42501'], 'anon não lê sinais');
select public.tmp_exige_erro($q$select count(*) from public.projeto_etapa_historico$q$, array['42501'], 'anon não lê histórico');
select public.tmp_exige_erro($q$select * from public.sugestao_etapa(public.tmp_p('01'))$q$, array['42501'], 'anon não pede sugestão');
select public.tmp_exige_erro($q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_u('1'))$q$, array['42501'], 'anon não aplica');

-- Ninguém escreve direto nas duas tabelas (nem o editor, nem o admin).
select public.tmp_como('d2');
select public.tmp_exige_negado(
  $q$insert into public.etapa_sinais (empreendimento_id, projeto_id, documento_id, tipo, data_arquivo) values (public.tmp_u('e001'), public.tmp_p('01'), public.tmp_doc(1), 'protocolo', now())$q$,
  'editor não insere sinal');
select public.tmp_exige_negado($q$update public.etapa_sinais set ignorado_em = now()$q$, 'editor não altera sinal');
select public.tmp_exige_negado($q$delete from public.etapa_sinais$q$, 'editor não apaga sinal');
select public.tmp_exige_negado(
  $q$insert into public.projeto_etapa_historico (projeto_id, origem) values (public.tmp_p('01'), 'manual')$q$,
  'editor não insere histórico');
select public.tmp_exige_negado($q$update public.projeto_etapa_historico set desfeito_em = now()$q$, 'editor não altera histórico');
select public.tmp_exige_negado($q$delete from public.projeto_etapa_historico$q$, 'editor não apaga histórico');
select public.tmp_como('d1');
select public.tmp_exige_negado($q$update public.etapa_sinais set ignorado_em = now()$q$, 'admin também não altera sinal direto');
select public.tmp_exige_negado($q$delete from public.projeto_etapa_historico$q$, 'admin também não apaga histórico direto');

-- ---------------------------------------------------------------------------
-- 5. Permissões das funções
-- ---------------------------------------------------------------------------

select public.tmp_como('d3');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1))$q$, array['42501'], 'só ver não aplica a sugestão');
select public.tmp_exige_erro(
  $q$select public.ignorar_sinal_etapa(public.tmp_sinal(1))$q$, array['42501'], 'só ver não ignora o sinal');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('01')], array[gen_random_uuid()])$q$, array['42501'], 'só ver não recalcula');
select public.tmp_como('d4');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1))$q$, array['42501'], 'sem permissão não aplica');
select public.tmp_exige_erro(
  $q$select public.ignorar_sinal_etapa(public.tmp_sinal(1))$q$, array['42501'], 'sem permissão não ignora');
select public.tmp_exige_erro(
  $q$select public.desfazer_etapa(public.tmp_u('1'))$q$, array['42501'], 'sem permissão não desfaz');
select public.tmp_como('d5');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1))$q$, array['42501'], 'cliente não aplica');
select public.tmp_como('d6');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1))$q$, array['42501'], 'fornecedor não aplica');

select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1), 'automatico')$q$, array['P0001'], 'o usuário não aplica com origem automática');
select public.tmp_exige_erro(
  $q$select public.etapa_aplicar_sinal_interno(public.tmp_p('01'), public.tmp_sinal(1), 'automatico')$q$, array['42501'], 'a função interna não é chamável');
select public.tmp_exige_erro(
  $q$select public.confirmar_envio_conector(gen_random_uuid(), public.tmp_u('0c01'), 'x', null, now(), null, null)$q$, array['42501'], 'confirmar o envio não é chamável por usuário');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), gen_random_uuid())$q$, array['P0001'], 'sinal que não é a sugestão atual');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(gen_random_uuid(), public.tmp_sinal(1))$q$, array['P0001'], 'projeto inexistente');
select public.tmp_exige_erro(
  $q$select public.desfazer_etapa(gen_random_uuid())$q$, array['P0001'], 'histórico inexistente');
select public.tmp_exige_erro(
  $q$select public.ignorar_sinal_etapa(gen_random_uuid())$q$, array['P0001'], 'sinal inexistente');

-- ---------------------------------------------------------------------------
-- 6. Sequência: protocolo (1) -> devolutiva -> protocolo (2) -> aprovado (modo sugerir)
-- ---------------------------------------------------------------------------

-- Sugestão do protocolo (1): Em análise, com a data do arquivo; aplicar preenche as etapas puladas.
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('01')) where tipo = 'protocolo' and etapa_id = public.tmp_e('01', 3) and sinal_id = public.tmp_sinal(1) and data_arquivo = public.tmp_t(10) and etapa_nome = 'Em Análise da Copasa'$q$,
  1, 'protocolo (1) sugere Em análise');
select public.tmp_exige_ok($q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1))$q$, 'aplicar a sugestão do protocolo (1)');

select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('01', 3) from public.projetos where id = public.tmp_p('01')$q$, 'a etapa atual virou Em análise');
select public.tmp_exige_verdade(
  $q$select (select count(*) from public.projeto_etapas e where e.projeto_id = public.tmp_p('01') and e.ordem in (1, 2) and e.concluida_em = (public.tmp_t(10) at time zone 'America/Sao_Paulo')::date) = 2
       and (select concluida_em from public.projeto_etapas where id = public.tmp_e('01', 3)) is null
       and (select concluida_em from public.projeto_etapas where id = public.tmp_e('01', 4)) is null$q$,
  'as etapas puladas recebem a data do arquivo e a etapa alvo não');
select public.tmp_exige_verdade(
  $q$select exists (
       select 1 from public.projeto_etapa_historico h
        where h.id = public.tmp_hist(1) and h.projeto_id = public.tmp_p('01') and h.origem = 'sugestao'
          and h.de_etapa_id = public.tmp_e('01', 1) and h.para_etapa_id = public.tmp_e('01', 3)
          and h.sinal_id = public.tmp_sinal(1) and h.por = public.tmp_u('d2') and h.desfeito_em is null
          and jsonb_array_length(h.datas_alteradas) = 2)$q$,
  'o histórico guarda de, para, sinal, quem e as datas alteradas');
select public.tmp_exige_verdade(
  $q$select aplicado_em is not null from public.etapa_sinais where id = public.tmp_sinal(1)$q$, 'o sinal fica marcado como aplicado');

select public.tmp_como('d2');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('01'))$q$, 0, 'depois de aplicar não há sugestão');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(1))$q$, array['P0001'], 'aplicar de novo o mesmo sinal');

select public.tmp_como('d3');
select public.tmp_exige_erro($q$select public.desfazer_etapa(public.tmp_hist(1))$q$, array['42501'], 'só ver não desfaz');

-- Arquivo mais antigo que a referência não sugere nada.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(2, public.tmp_u('f011'), public.tmp_t(0))->>'situacao'$q$, 'confirmado', 'protocolo antigo confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('01'))$q$, 0, 'sinal mais antigo que a referência não sugere');

-- Devolutiva (LAN): volta para Em confecção.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(3, public.tmp_u('f012'), public.tmp_t(30))->>'situacao'$q$, 'confirmado', 'devolutiva confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('01')) where tipo = 'devolutiva' and etapa_id = public.tmp_e('01', 2) and sinal_id = public.tmp_sinal(3)$q$,
  1, 'a devolutiva sugere Em confecção');
select public.tmp_exige_ok($q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(3))$q$, 'aplicar a devolutiva');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('01', 2)
        and (select concluida_em from public.projeto_etapas where id = public.tmp_e('01', 2)) is null
        and (select concluida_em from public.projeto_etapas where id = public.tmp_e('01', 1)) = (public.tmp_t(10) at time zone 'America/Sao_Paulo')::date
        and (select d->>'anterior' = ((public.tmp_t(10) at time zone 'America/Sao_Paulo')::date)::text and d->'novo' = 'null'::jsonb
               from public.projeto_etapa_historico h, jsonb_array_elements(h.datas_alteradas) d
              where h.id = public.tmp_hist(3) and (d->>'etapa_id')::uuid = public.tmp_e('01', 2))
        and jsonb_array_length((select datas_alteradas from public.projeto_etapa_historico where id = public.tmp_hist(3))) = 1
     from public.projetos where id = public.tmp_p('01')$q$,
  'voltar para confecção limpa a data dela (guardada para o desfazer) e mantém a das anteriores');

-- Protocolo (2): Em análise de novo.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(4, public.tmp_u('f011'), public.tmp_t(60))->>'situacao'$q$, 'confirmado', 'protocolo (2) confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('01')) where tipo = 'protocolo' and etapa_id = public.tmp_e('01', 3) and sinal_id = public.tmp_sinal(4)$q$,
  1, 'o protocolo (2) sugere Em análise');
select public.tmp_exige_ok($q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(4))$q$, 'aplicar o protocolo (2)');

-- Aprovado: pula para Aprovado, preenchendo Em análise e o próprio Aprovado.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(5, public.tmp_u('f013'), public.tmp_t(90))->>'situacao'$q$, 'confirmado', 'aprovado confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('01')) where tipo = 'aprovado' and etapa_id = public.tmp_e('01', 4) and sinal_id = public.tmp_sinal(5)$q$,
  1, 'o aprovado sugere Aprovado');
select public.tmp_exige_ok($q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(5))$q$, 'aplicar o aprovado');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('01', 4)
        and (select count(*) from public.projeto_etapas e where e.projeto_id = public.tmp_p('01') and e.ordem in (3, 4) and e.concluida_em = (public.tmp_t(90) at time zone 'America/Sao_Paulo')::date) = 2
        and jsonb_array_length((select datas_alteradas from public.projeto_etapa_historico where id = public.tmp_hist(5))) = 2
     from public.projetos where id = public.tmp_p('01')$q$,
  'aprovado: a etapa alvo e a etapa pulada ficam com a data do arquivo');

-- Depois de aprovado nada é sugerido, nem arquivo mais novo.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(6, public.tmp_u('f011'), public.tmp_t(120))->>'situacao'$q$, 'confirmado', 'protocolo tardio confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('01'))$q$, 0, 'depois de aprovado nada volta sozinho');

-- Ignorar.
select public.tmp_exige_ok($q$select public.ignorar_sinal_etapa(public.tmp_sinal(6))$q$, 'ignorar o protocolo tardio');
select public.tmp_exige_ok($q$select public.ignorar_sinal_etapa(public.tmp_sinal(6))$q$, 'ignorar duas vezes é idempotente');
select public.tmp_exige_verdade(
  $q$select ignorado_em is not null and ignorado_por = public.tmp_u('d2') from public.etapa_sinais where id = public.tmp_sinal(6)$q$, 'quem ignorou fica registrado');
select public.tmp_exige_erro($q$select public.ignorar_sinal_etapa(public.tmp_sinal(5))$q$, array['P0001'], 'não se ignora sinal já aplicado');

-- ---------------------------------------------------------------------------
-- 7. Desfazer
-- ---------------------------------------------------------------------------

select public.tmp_exige_erro($q$select public.desfazer_etapa(public.tmp_hist(4))$q$, array['P0001'], 'só o último pode ser desfeito');
select public.tmp_exige_ok($q$select public.desfazer_etapa(public.tmp_hist(5))$q$, 'desfazer o aprovado');

select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select p.etapa_atual_id = public.tmp_e('01', 3)
        and (select count(*) from public.projeto_etapas e where e.projeto_id = p.id and e.ordem in (3, 4) and e.concluida_em is not null) = 0
        and (select aplicado_em is null from public.etapa_sinais where id = public.tmp_sinal(5))
        and exists (select 1 from public.projeto_etapa_historico h where h.id = public.tmp_hist(5) and h.desfeito_em is not null and h.desfeito_por = public.tmp_u('d2'))
        and exists (select 1 from public.projeto_etapa_historico h where h.projeto_id = p.id and h.origem = 'desfazer' and h.sinal_id = public.tmp_sinal(5) and h.de_etapa_id = public.tmp_e('01', 4) and h.para_etapa_id = public.tmp_e('01', 3))
     from public.projetos p where p.id = public.tmp_p('01')$q$,
  'desfazer restaura a etapa e as datas, marca o registro e guarda um histórico "desfazer"');

select public.tmp_como('d2');
select public.tmp_exige_erro($q$select public.desfazer_etapa(public.tmp_hist(5))$q$, array['P0001'], 'não se desfaz duas vezes');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('01')) where tipo = 'aprovado' and etapa_id = public.tmp_e('01', 4) and sinal_id = public.tmp_sinal(5)$q$,
  1, 'o sinal desfeito volta a ser sugerido (o protocolo tardio está ignorado)');

-- O penúltimo passa a ser o último; desfazer até o começo devolve etapa e datas do início.
select public.tmp_exige_ok($q$select public.desfazer_etapa(public.tmp_hist(4))$q$, 'desfazer o protocolo (2)');
select public.tmp_exige_ok($q$select public.desfazer_etapa(public.tmp_hist(3))$q$, 'desfazer a devolutiva');
select public.tmp_exige_ok($q$select public.desfazer_etapa(public.tmp_hist(1))$q$, 'desfazer o protocolo (1)');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select p.etapa_atual_id = public.tmp_e('01', 1)
        and (select count(*) from public.projeto_etapas e where e.projeto_id = p.id and e.concluida_em is not null) = 0
        and (select count(*) from public.etapa_sinais s where s.projeto_id = p.id and s.aplicado_em is not null) = 0
     from public.projetos p where p.id = public.tmp_p('01')$q$,
  'desfeito tudo: etapa inicial, nenhuma data e nenhum sinal aplicado');

select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('01')) where tipo = 'aprovado' and etapa_id = public.tmp_e('01', 4)$q$,
  1, 'sem histórico o estado final dos arquivos volta a ser sugerido');

-- Mudança manual: entra no histórico, não se desfaz e empurra a referência (arquivo mais antigo não sugere).
select public.tmp_exige_ok(
  $q$update public.projetos set etapa_atual_id = public.tmp_e('01', 2) where id = public.tmp_p('01')$q$, 'mudança manual de etapa');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.projeto_etapa_historico h where h.projeto_id = public.tmp_p('01') and h.origem = 'manual' and h.sinal_id is null and h.por = public.tmp_u('d2') and h.de_etapa_id = public.tmp_e('01', 1) and h.para_etapa_id = public.tmp_e('01', 2))$q$,
  'a mudança manual entra no histórico');
select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$select public.desfazer_etapa((select id from public.projeto_etapa_historico where projeto_id = public.tmp_p('01') and origem = 'manual'))$q$,
  array['P0001'], 'mudança manual não tem desfazer');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('01'))$q$, 0, 'depois de mudança manual, arquivo mais antigo não sugere');

-- ---------------------------------------------------------------------------
-- 8. Modelos sem confecção, sem aprovado e sem marcos
-- ---------------------------------------------------------------------------

-- Termo/OS: a devolutiva sugere Em análise (não há confecção).
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(50, public.tmp_u('f022'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'devolutiva do Termo confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('02')) where tipo = 'devolutiva' and etapa_id = public.tmp_e('02', 2)$q$,
  1, 'sem confecção, a devolutiva sugere Em análise');
select public.tmp_exige_ok($q$select public.aplicar_sugestao_etapa(public.tmp_p('02'), public.tmp_sinal(50))$q$, 'aplicar no Termo');

-- Protocolo cujo alvo já é a etapa atual não sugere.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(51, public.tmp_u('f021'), public.tmp_t(20))->>'situacao'$q$, 'confirmado', 'protocolo do Termo confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('02'))$q$, 0, 'alvo igual à etapa atual não sugere');

select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(52, public.tmp_u('f023'), public.tmp_t(30))->>'situacao'$q$, 'confirmado', 'aprovado do Termo confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('02')) where tipo = 'aprovado' and etapa_id = public.tmp_e('02', 3) and etapa_nome = 'Aprovado, obras em andamento'$q$,
  1, 'o aprovado do Termo é "Aprovado, obras em andamento"');

-- Doação não tem marcos: nenhum sinal sugere nada.
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(60, public.tmp_u('f031'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo da Doação confirma');
select public.tmp_exige_texto($q$select public.tmp_chega(61, public.tmp_u('f033'), public.tmp_t(20))->>'situacao'$q$, 'confirmado', 'aprovado da Doação confirma');
select public.tmp_como('d2');
select public.tmp_exige_conta($q$select count(*) from public.sugestao_etapa(public.tmp_p('03'))$q$, 0, 'projeto sem marcos não recebe sugestão');

-- ---------------------------------------------------------------------------
-- 9. Modo automático (E2): avança na hora, isola erro e aceita desfazer
-- ---------------------------------------------------------------------------

-- Com o modo desligado o sinal é gravado e nada avança; o p07 fica pendente para o recálculo (E2 não é E1).
select public.tmp_como('postgres');
select public.tmp_exige_texto($q$select public.tmp_chega(23, public.tmp_u('f071'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo pendente do p07');
select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.etapa_sinais where id = public.tmp_sinal(23) and aplicado_em is null)
        and (select etapa_atual_id = public.tmp_e('07', 1) from public.projetos where id = public.tmp_p('07'))$q$,
  'modo desligado grava o sinal e não avança');

update public.empreendimentos set etapas_modo = 'automatico' where id = public.tmp_u('e002');

select public.tmp_exige_texto($q$select public.tmp_chega(30, public.tmp_u('f041'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo automático confirma');
select public.tmp_exige_verdade(
  $q$select p.etapa_atual_id = public.tmp_e('04', 3)
        and (select count(*) from public.projeto_etapas e where e.projeto_id = p.id and e.ordem in (1, 2) and e.concluida_em = (public.tmp_t(10) at time zone 'America/Sao_Paulo')::date) = 2
        and exists (select 1 from public.etapa_sinais s where s.id = public.tmp_sinal(30) and s.aplicado_em is not null)
        and exists (select 1 from public.projeto_etapa_historico h where h.id = public.tmp_hist(30) and h.origem = 'automatico' and h.por is null and h.sinal_id = public.tmp_sinal(30) and h.de_etapa_id = public.tmp_e('04', 1) and h.para_etapa_id = public.tmp_e('04', 3))
     from public.projetos p where p.id = public.tmp_p('04')$q$,
  'no modo automático o protocolo avança a etapa na hora, com histórico "automatico" e sem usuário');

select public.tmp_exige_texto($q$select public.tmp_chega(31, public.tmp_u('f042'), public.tmp_t(30))->>'situacao'$q$, 'confirmado', 'devolutiva automática confirma');
select public.tmp_exige_verdade($q$select etapa_atual_id = public.tmp_e('04', 2) from public.projetos where id = public.tmp_p('04')$q$, 'a devolutiva automática volta para confecção');
select public.tmp_exige_texto($q$select public.tmp_chega(32, public.tmp_u('f041'), public.tmp_t(60))->>'situacao'$q$, 'confirmado', 'protocolo (2) automático confirma');
select public.tmp_exige_verdade($q$select etapa_atual_id = public.tmp_e('04', 3) from public.projetos where id = public.tmp_p('04')$q$, 'o protocolo (2) automático volta para análise');
select public.tmp_exige_texto($q$select public.tmp_chega(33, public.tmp_u('f043'), public.tmp_t(90))->>'situacao'$q$, 'confirmado', 'aprovado automático confirma');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('04', 4)
        and (select count(*) from public.projeto_etapas e where e.projeto_id = public.tmp_p('04') and e.ordem in (3, 4) and e.concluida_em = (public.tmp_t(90) at time zone 'America/Sao_Paulo')::date) = 2
     from public.projetos where id = public.tmp_p('04')$q$,
  'o aprovado automático chega em Aprovado e preenche as datas');
select public.tmp_exige_texto($q$select public.tmp_chega(34, public.tmp_u('f041'), public.tmp_t(120))->>'situacao'$q$, 'confirmado', 'protocolo tardio automático confirma');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('04', 4) from public.projetos where id = public.tmp_p('04')$q$, 'depois de aprovado o automático não volta');
select public.tmp_exige_conta(
  $q$select count(*) from public.projeto_etapa_historico where projeto_id = public.tmp_p('04') and origem = 'automatico'$q$, 4, 'quatro mudanças automáticas no histórico');

-- O automático também se desfaz (o último), por quem tem empreendimentos.editar.
select public.tmp_como('d2');
select public.tmp_exige_ok($q$select public.desfazer_etapa(public.tmp_hist(33))$q$, 'desfazer a mudança automática');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select etapa_atual_id = public.tmp_e('04', 3) from public.projetos where id = public.tmp_p('04')$q$, 'desfazer o automático volta a etapa');

-- Regra sem sinal não gera sinal; sem mtime vale a hora do envio.
select public.tmp_exige_texto($q$select public.tmp_chega(41, public.tmp_u('f049'), public.tmp_t(130))->>'situacao'$q$, 'confirmado', 'arquivo de regra sem sinal confirma');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where documento_id = public.tmp_doc(41)$q$, 0, 'regra sem sinal não gera sinal');
select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.documentos where id = public.tmp_doc(41))$q$, 'o documento da regra sem sinal foi criado');

update public.empreendimentos set etapas_modo = 'sugerir' where id = public.tmp_u('e002');
select public.tmp_exige_texto($q$select public.tmp_chega(42, public.tmp_u('f071'), null)->>'situacao'$q$, 'confirmado', 'protocolo sem mtime confirma');
select public.tmp_exige_verdade(
  $q$select s.data_arquivo = (select e.em from public.conector_envios e where e.documento_planejado_id = public.tmp_doc(42))
     from public.etapa_sinais s where s.id = public.tmp_sinal(42)$q$,
  'sem mtime, a data do arquivo é a hora do envio');
update public.empreendimentos set etapas_modo = 'automatico' where id = public.tmp_u('e002');

-- Erro ao aplicar o automático não desfaz o documento nem o sinal.
select public.tmp_exige_texto($q$select public.tmp_chega(40, public.tmp_u('f051'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'a confirmação sobrevive ao erro do automático');
select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.documentos where id = public.tmp_doc(40))
        and exists (select 1 from public.conector_envios where documento_planejado_id = public.tmp_doc(40) and estado = 'confirmado')
        and exists (select 1 from public.etapa_sinais where id = public.tmp_sinal(40) and aplicado_em is null)
        and (select etapa_atual_id = public.tmp_e('05', 1) from public.projetos where id = public.tmp_p('05'))
        and not exists (select 1 from public.projeto_etapa_historico where projeto_id = public.tmp_p('05'))$q$,
  'documento e sinal ficam, a etapa não muda e nada entra no histórico');

update public.empreendimentos set etapas_modo = 'desligado' where id = public.tmp_u('e002');

-- ---------------------------------------------------------------------------
-- 10. Recalcular o empreendimento (modo sugerir em E1)
-- ---------------------------------------------------------------------------

-- p06: protocolo e aprovado com a mesma data: o aprovado vence o empate.
select public.tmp_exige_texto($q$select public.tmp_chega(20, public.tmp_u('f061'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo do p06');
select public.tmp_exige_texto($q$select public.tmp_chega(21, public.tmp_u('f063'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'aprovado do p06');
select public.tmp_exige_texto($q$select public.tmp_chega(24, public.tmp_u('f081'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo do p08');
select public.tmp_exige_texto($q$select public.tmp_chega(22, public.tmp_u('f0f1'), public.tmp_t(10))->>'situacao'$q$, 'confirmado', 'protocolo do projeto que falha');

select public.tmp_como('d2');
select public.tmp_exige_conta(
  $q$select count(*) from public.sugestao_etapa(public.tmp_p('06')) where tipo = 'aprovado' and sinal_id = public.tmp_sinal(21) and etapa_id = public.tmp_e('06', 4)$q$,
  1, 'empate de data: aprovado vence protocolo');

select public.tmp_exige_erro($q$select public.aplicar_sugestoes_empreendimento(null, array[public.tmp_p('06')], array[public.tmp_sinal(21)])$q$, array['P0001'], 'empreendimento nulo');
select public.tmp_exige_erro($q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[]::uuid[], array[]::uuid[])$q$, array['P0001'], 'lista vazia');
select public.tmp_exige_erro($q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), null, null)$q$, array['P0001'], 'lista nula');
select public.tmp_exige_erro($q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('06'), public.tmp_p('08')], array[public.tmp_sinal(21)])$q$, array['P0001'], 'listas de tamanhos diferentes');
select public.tmp_exige_erro($q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('06'), public.tmp_p('06')], array[public.tmp_sinal(21), public.tmp_sinal(21)])$q$, array['P0001'], 'projeto repetido');
select public.tmp_exige_texto($q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('06')], array[public.tmp_sinal(20)])::text$q$, '0', 'sinal diferente do sugerido (a tela ficou velha) não é aplicado');
select public.tmp_exige_erro($q$select public.aplicar_sugestoes_empreendimento(gen_random_uuid(), array[public.tmp_p('06')], array[public.tmp_sinal(21)])$q$, array['P0001'], 'empreendimento inexistente');

-- Tudo ou nada: p08 (aplicável) vem antes do projeto que falha na ordem do id; nada fica aplicado.
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('08'), public.tmp_p('0f')], array[public.tmp_sinal(24), public.tmp_sinal(22)])$q$,
  array['P0001'], 'um projeto que falha desfaz o recálculo inteiro');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select (select etapa_atual_id = public.tmp_e('08', 1) from public.projetos where id = public.tmp_p('08'))
        and not exists (select 1 from public.projeto_etapa_historico where projeto_id = public.tmp_p('08'))
        and (select aplicado_em is null from public.etapa_sinais where id = public.tmp_sinal(24))$q$,
  'tudo ou nada: o p08 continua como estava');

-- Recálculo de verdade: p06 e p08 aplicam; p07 (de E2) na lista é ignorado; o resultado conta quantos aplicou.
select public.tmp_como('d2');
select public.tmp_exige_texto(
  $q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('06'), public.tmp_p('07'), public.tmp_p('08')], array[public.tmp_sinal(21), gen_random_uuid(), public.tmp_sinal(24)])::text$q$,
  '2', 'o recálculo aplica o projeto de E1 e ignora o de E2');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select (select etapa_atual_id = public.tmp_e('06', 4) from public.projetos where id = public.tmp_p('06'))
        and (select etapa_atual_id = public.tmp_e('08', 3) from public.projetos where id = public.tmp_p('08'))
        and (select etapa_atual_id = public.tmp_e('07', 1) from public.projetos where id = public.tmp_p('07'))
        and exists (select 1 from public.projeto_etapa_historico h where h.id = public.tmp_hist(21) and h.origem = 'recalculo' and h.por = public.tmp_u('d2'))
        and (select count(*) from public.projeto_etapas e where e.projeto_id = public.tmp_p('06') and e.ordem <= 4 and e.concluida_em is not null) = 4
        and (select aplicado_em is null from public.etapa_sinais where id = public.tmp_sinal(23))$q$,
  'recálculo: um registro "recalculo" por projeto, o estado final de cada um e o projeto de outro empreendimento intacto');
select public.tmp_como('d2');
select public.tmp_exige_texto(
  $q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('06'), public.tmp_p('08')], array[public.tmp_sinal(21), public.tmp_sinal(24)])::text$q$,
  '0', 'repetir o recálculo não aplica nada');

-- ---------------------------------------------------------------------------
-- 11. Preenchimento dos sinais dos envios que já chegaram (mesmo INSERT da migration, só em E1)
-- ---------------------------------------------------------------------------

select public.tmp_como('postgres');
delete from public.etapa_sinais where documento_id = public.tmp_doc(2);
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where documento_id = public.tmp_doc(2)$q$, 0, 'sinal removido para o preenchimento');

insert into public.etapa_sinais (empreendimento_id, projeto_id, documento_id, tipo, data_arquivo)
select e.empreendimento_id, r.projeto_id, e.documento_id, r.sinal, coalesce(e.mtime, e.em)
from public.conector_envios e
join public.pasta_regras r on r.id = e.regra_id
where e.estado = 'confirmado'
  and e.documento_id is not null
  and r.sinal is not null
  and r.projeto_id is not null
  and e.empreendimento_id = public.tmp_u('e001')
on conflict (documento_id) do nothing;

select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.etapa_sinais s where s.documento_id = public.tmp_doc(2) and s.tipo = 'protocolo' and s.data_arquivo = public.tmp_t(0) and s.projeto_id = public.tmp_p('01'))$q$,
  'o preenchimento recria o sinal com a data do arquivo');
select public.tmp_exige_conta(
  $q$select count(*) from public.etapa_sinais where documento_id in (public.tmp_doc(1), public.tmp_doc(2), public.tmp_doc(3), public.tmp_doc(4), public.tmp_doc(5), public.tmp_doc(6))$q$,
  6, 'o preenchimento não duplica os sinais que já existem');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where documento_id = public.tmp_doc(41)$q$, 0, 'regra sem sinal continua sem sinal');

-- Apagar o documento leva o sinal junto; o histórico mantém a linha (sinal_id fica nulo).
select public.tmp_exige_conta($q$select count(*) from public.projeto_etapa_historico where sinal_id = public.tmp_sinal(33)$q$, 2, 'histórico do aprovado automático: aplicação e desfazer');
delete from public.documento_origens where documento_id = public.tmp_doc(33);
delete from public.documentos where id = public.tmp_doc(33);
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where documento_id = public.tmp_doc(33)$q$, 0, 'apagar o documento apaga o sinal');
select public.tmp_exige_conta(
  $q$select count(*) from public.projeto_etapa_historico where projeto_id = public.tmp_p('04') and sinal_id is null and origem in ('automatico', 'desfazer')$q$,
  2, 'o histórico sobrevive à exclusão do sinal');

-- Apagar o projeto leva o histórico em cascata (os documentos saem antes: a FK deles com o projeto é set null e um
-- documento de regra sem projeto nem grupo não é um estado que este teste queira criar).
delete from public.documentos where id in (public.tmp_doc(30), public.tmp_doc(31), public.tmp_doc(32), public.tmp_doc(34), public.tmp_doc(41));
delete from public.projetos where id = public.tmp_p('04');
select public.tmp_exige_conta($q$select count(*) from public.projeto_etapa_historico where projeto_id = public.tmp_p('04')$q$, 0, 'apagar o projeto apaga o histórico');
select public.tmp_exige_conta($q$select count(*) from public.etapa_sinais where projeto_id = public.tmp_p('04')$q$, 0, 'apagar o projeto apaga os sinais');

-- ---------------------------------------------------------------------------
-- 12. Privilégios de execução
-- ---------------------------------------------------------------------------

do $$
declare
  v_assinatura text;
begin
  foreach v_assinatura in array array[
    'public.etapa_sugestao_calcular(uuid)',
    'public.marco_da_etapa_por_nome(text)',
    'public.sugestao_etapa(uuid)',
    'public.aplicar_sugestao_etapa(uuid, uuid, text)',
    'public.ignorar_sinal_etapa(uuid)',
    'public.desfazer_etapa(uuid)',
    'public.aplicar_sugestoes_empreendimento(uuid, uuid[], uuid[])'
  ] loop
    if has_function_privilege('anon', v_assinatura, 'execute') then
      raise exception 'FALHA: anon não executa %', v_assinatura;
    end if;
    if not has_function_privilege('authenticated', v_assinatura, 'execute') then
      raise exception 'FALHA: authenticated executa %', v_assinatura;
    end if;
  end loop;

  foreach v_assinatura in array array[
    'public.etapa_aplicar_sinal_interno(uuid, uuid, text)',
    'public.registrar_historico_etapa()',
    'public.proteger_modo_etapas_empreendimento()',
    'public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)'
  ] loop
    if has_function_privilege('anon', v_assinatura, 'execute') or has_function_privilege('authenticated', v_assinatura, 'execute') then
      raise exception 'FALHA: anon e authenticated não executam %', v_assinatura;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)', 'execute') then
    raise exception 'FALHA: service_role executa confirmar_envio_conector';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'confirmar_envio_conector') <> 1 then
    raise exception 'FALHA: deve existir uma só confirmar_envio_conector';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'criar_projeto_de_modelo') <> 1 then
    raise exception 'FALHA: deve existir uma só criar_projeto_de_modelo';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.etapa_sinais'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.projeto_etapa_historico'::regclass) then
    raise exception 'FALHA: RLS ligado nas duas tabelas novas';
  end if;
end
$$;

select public.tmp_como('postgres');

-- ---------------------------------------------------------------------------
-- Extra (líder): sinal padrão na regra nova e marcos pela tela Modelos
-- ---------------------------------------------------------------------------

-- Regra comum de projeto com segmento APROVADO nasce com sinal 'aprovado'; sem APROVADO, sem sinal; sinal informado vale.
insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, tipo, projeto_id)
values (public.tmp_u('fa001'), public.tmp_u('e001'), 'XX/P/02 - LAN/01 - Aprovado no Interliga', 'comum', public.tmp_p('01')),
       (public.tmp_u('fa002'), public.tmp_u('e001'), 'XX/P/01 - DOCUMENTOS', 'comum', public.tmp_p('01')),
       (public.tmp_u('fa003'), public.tmp_u('e001'), 'XX/D/03 - CERTIDÃO APROVADA', 'comum', public.tmp_p('03'));
select public.tmp_exige_texto($q$select sinal from public.pasta_regras where id = public.tmp_u('fa001')$q$, 'aprovado', 'regra nova no APROVADO ganha sinal aprovado');
select public.tmp_exige_texto($q$select sinal from public.pasta_regras where id = public.tmp_u('fa002')$q$, null, 'regra nova fora do APROVADO fica sem sinal');
select public.tmp_exige_texto($q$select sinal from public.pasta_regras where id = public.tmp_u('fa003')$q$, null, 'projeto sem marco aprovado (Doação) fica sem sinal');

-- Tela Modelos: grava, troca e preserva marcos.
select public.tmp_como('d2');
do $$
declare v_modelo uuid; v_a uuid; v_b uuid;
begin
  v_modelo := public.salvar_modelo_portal(null, 'Modelo marcos teste', null, true,
    '[{"nome":"Não Iniciado","ordem":1},{"nome":"Fazendo","ordem":2,"marco":"confeccao"},{"nome":"Na Copasa","ordem":3,"marco":"analise"},{"nome":"Ok","ordem":4,"marco":"aprovado"}]'::jsonb,
    '[]'::jsonb);
  if (select count(*) from public.modelo_etapas_itens where modelo_id = v_modelo and marco is not null) <> 3 then
    raise exception 'FALHA: salvar_modelo_portal grava os marcos';
  end if;
  select id into v_a from public.modelo_etapas_itens where modelo_id = v_modelo and ordem = 2;
  select id into v_b from public.modelo_etapas_itens where modelo_id = v_modelo and ordem = 3;
  -- troca analise <-> confeccao entre duas etapas existentes (não pode bater no índice único)
  perform public.salvar_modelo_portal(v_modelo, 'Modelo marcos teste', null, true,
    jsonb_build_array(
      jsonb_build_object('id', (select id from public.modelo_etapas_itens where modelo_id = v_modelo and ordem = 1), 'nome', 'Não Iniciado', 'ordem', 1, 'marco', null),
      jsonb_build_object('id', v_a, 'nome', 'Fazendo', 'ordem', 2, 'marco', 'analise'),
      jsonb_build_object('id', v_b, 'nome', 'Na Copasa', 'ordem', 3, 'marco', 'confeccao'),
      jsonb_build_object('id', (select id from public.modelo_etapas_itens where modelo_id = v_modelo and ordem = 4), 'nome', 'Ok', 'ordem', 4, 'marco', 'aprovado')),
    '[]'::jsonb);
  if (select marco from public.modelo_etapas_itens where id = v_a) <> 'analise' or (select marco from public.modelo_etapas_itens where id = v_b) <> 'confeccao' then
    raise exception 'FALHA: trocar marcos entre etapas';
  end if;
  -- cliente antigo, sem a chave marco, preserva os marcos
  perform public.salvar_modelo_portal(v_modelo, 'Modelo marcos teste 2', null, true,
    jsonb_build_array(
      jsonb_build_object('id', (select id from public.modelo_etapas_itens where modelo_id = v_modelo and ordem = 1), 'nome', 'Não Iniciado', 'ordem', 1),
      jsonb_build_object('id', v_a, 'nome', 'Fazendo', 'ordem', 2),
      jsonb_build_object('id', v_b, 'nome', 'Na Copasa', 'ordem', 3),
      jsonb_build_object('id', (select id from public.modelo_etapas_itens where modelo_id = v_modelo and ordem = 4), 'nome', 'Ok', 'ordem', 4)),
    '[]'::jsonb);
  if (select count(*) from public.modelo_etapas_itens where modelo_id = v_modelo and marco is not null) <> 3 then
    raise exception 'FALHA: lista sem a chave marco preserva os marcos';
  end if;
end
$$;
select public.tmp_exige_erro(
  $q$select public.salvar_modelo_portal(null, 'Modelo marco repetido', null, true, '[{"nome":"Um um","ordem":1,"marco":"analise"},{"nome":"Dois dois","ordem":2,"marco":"analise"}]'::jsonb, '[]'::jsonb)$q$,
  array['22023'], 'marco repetido na lista é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_modelo_portal(null, 'Modelo marco ruim', null, true, '[{"nome":"Um um","ordem":1,"marco":"pago"}]'::jsonb, '[]'::jsonb)$q$,
  array['22023'], 'marco desconhecido é recusado');
-- Modo desligado: confirmar sugestão e recalcular são recusados mesmo chamando a função direto.
select public.tmp_como('postgres');
update public.empreendimentos set etapas_modo = 'desligado' where id = public.tmp_u('e001');
select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestao_etapa(public.tmp_p('01'), public.tmp_sinal(5))$q$, array['P0001'], 'modo desligado não confirma sugestão');
select public.tmp_exige_erro(
  $q$select public.aplicar_sugestoes_empreendimento(public.tmp_u('e001'), array[public.tmp_p('01')], array[public.tmp_sinal(5)])$q$, array['P0001'], 'modo desligado não recalcula');
select public.tmp_como('postgres');
update public.empreendimentos set etapas_modo = 'sugerir' where id = public.tmp_u('e001');

select public.tmp_como('d3');
select public.tmp_exige_erro(
  $q$select public.salvar_modelo_portal(null, 'Modelo sem permissão', null, true, '[{"nome":"Um um","ordem":1,"marco":"analise"}]'::jsonb, '[]'::jsonb)$q$,
  array['42501'], 'sem editar não salva modelo');
select public.tmp_como('postgres');

select 'OK: etapas automáticas pelas pastas passaram nos testes' as resultado;

rollback;
