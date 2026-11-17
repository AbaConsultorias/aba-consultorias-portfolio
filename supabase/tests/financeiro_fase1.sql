-- Testes da fase 1 do financeiro automático (docs/FINANCEIRO-FASE1-CONTRATO.md; migration 20261116100000_financeiro_fase1.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/financeiro_fase1.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/financeiro_fase1.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece numa transação que termina em ROLLBACK. Se alguma
-- verificação falhar, o script para com "FALHA: ..."; se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids 94000000-0000-0000-0000-..., montados por public.tmp_u):
--   contas: d1 admin; d2 equipe com financeiro.ver + editar e empreendimentos.ver + editar; d3 equipe só com financeiro.ver;
--           d4 equipe sem permissão; d5 cliente do empreendimento E1
--   empreendimentos: E1 (e001) e E2 (e002)
--   projetos (b0NN; etapas c0NN1...): 01 SAA, 02 Termo/OS, 03 Doação (sem marco), 06 desfazer e 07 LAN (SAA), todos em E1;
--           a1..a6 (SAA, retroativos) e 04 em E2
--   contratos criados pelos testes: 940101C (assinatura + data + aprovação), 940102C (eventos variados), 940104C (a cobrar, E2)
-- Os dias são relativos a "hoje" de Brasília (public.tmp_hoje()), para o teste não envelhecer.
-- Observação: dentro de uma transação now() não muda, então o atualizado_em de um contrato não se mexe entre duas
-- chamadas do teste; a edição concorrente é provada passando um atualizado_em antigo.

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

-- Erro com a mensagem esperada (padrão de LIKE).
create function public.tmp_exige_mensagem(p_sql text, p_padrao text, p_msg text)
returns void language plpgsql as $$
declare
  v_mensagem text;
begin
  begin
    execute p_sql;
  exception when others then
    v_mensagem := sqlerrm;
  end;
  if v_mensagem is null then
    raise exception 'FALHA: % (não deu erro)', p_msg;
  end if;
  if v_mensagem not like p_padrao then
    raise exception 'FALHA: % (mensagem "%", esperado "%")', p_msg, v_mensagem, p_padrao;
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
  select ('94000000-0000-0000-0000-' || lpad(p, 12, '0'))::uuid
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
  select ('94000000-0000-0000-0001-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Hoje em Brasília, como o banco calcula.
create function public.tmp_hoje()
returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Meio-dia (Brasília) de uma data: o dia continua o mesmo ao voltar para Brasília.
create function public.tmp_meiodia(p_data date)
returns timestamptz language sql immutable as $$
  select (p_data::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
$$;

create function public.tmp_item(p_codigo text)
returns uuid language sql stable as $$
  select i.id from public.itens_financeiros i where i.codigo = p_codigo
$$;

create function public.tmp_pid(p_codigo text, p_numero int)
returns uuid language sql stable as $$
  select pa.id from public.parcelas pa where pa.item_id = public.tmp_item(p_codigo) and pa.numero = p_numero
$$;

create function public.tmp_atual(p_codigo text)
returns timestamptz language sql stable as $$
  select i.atualizado_em from public.itens_financeiros i where i.codigo = p_codigo
$$;

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

-- Projeto com as etapas do tipo (marco preenchido pelo nome) e a etapa de ordem p_inicial como etapa atual. A primeira
-- atribuição (etapa_atual_id nulo -> etapa) não entra no histórico, então não gera evento: serve de "o que já aconteceu".
create function public.tmp_novo_projeto(p_emp uuid, p_code text, p_nome text, p_tipo text, p_inicial int default 1)
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
  update public.projetos set etapa_atual_id = public.tmp_e(p_code, p_inicial) where id = v_projeto;
end;
$$;

-- Muda a etapa do projeto como o app faz: a origem (e o sinal) vão por variável de sessão e são limpos logo depois.
create function public.tmp_mover(p_code text, p_ordem int, p_origem text default 'manual', p_sinal uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('aba.etapa_origem', p_origem, true);
  perform set_config('aba.etapa_sinal', coalesce(p_sinal::text, ''), true);
  update public.projetos set etapa_atual_id = public.tmp_e(p_code, p_ordem) where id = public.tmp_p(p_code);
  perform set_config('aba.etapa_origem', '', true);
  perform set_config('aba.etapa_sinal', '', true);
end;
$$;

create function public.tmp_concluida(p_code text, p_ordem int, p_data date)
returns void language sql as $$
  update public.projeto_etapas set concluida_em = p_data where id = public.tmp_e(p_code, p_ordem)
$$;

-- Parcela e contrato no formato que salvar_contrato_portal recebe.
create function public.tmp_parcela(
  p_nome text, p_valor bigint, p_gatilho text, p_vencimento date default null, p_tipo text default null,
  p_projeto uuid default null, p_descricao text default null, p_dias int default null, p_id uuid default null
)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_id, 'nome', p_nome, 'valor_previsto_centavos', p_valor::text, 'gatilho', p_gatilho, 'vencimento', p_vencimento,
    'evento_tipo', p_tipo, 'evento_projeto_id', p_projeto, 'evento_descricao', p_descricao, 'dias_apos', p_dias))
$$;

create function public.tmp_dados(
  p_codigo text, p_assinado date, p_parcelas jsonb, p_projetos jsonb default '[]'::jsonb,
  p_documento uuid default null, p_versao int default 1
)
returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'descricao', 'Contrato de teste', 'codigo', p_codigo, 'versao', p_versao, 'assinado_em', p_assinado,
    'documento_id', p_documento, 'valor_contratado_centavos', '10000000', 'projetos', p_projetos, 'parcelas', p_parcelas))
$$;

grant execute on function
  public.tmp_exige_ok(text, text), public.tmp_exige_erro(text, text[], text), public.tmp_exige_mensagem(text, text, text),
  public.tmp_exige_negado(text, text), public.tmp_exige_conta(text, bigint, text), public.tmp_exige_maior(text, bigint, text),
  public.tmp_exige_texto(text, text, text), public.tmp_exige_verdade(text, text),
  public.tmp_u(text), public.tmp_p(text), public.tmp_e(text, int), public.tmp_doc(int), public.tmp_hoje(),
  public.tmp_meiodia(date), public.tmp_item(text), public.tmp_pid(text, int), public.tmp_atual(text),
  public.tmp_como(text),
  public.tmp_parcela(text, bigint, text, date, text, uuid, text, int, uuid),
  public.tmp_dados(text, date, jsonb, jsonb, uuid, int)
  to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
  (public.tmp_u('d1'), 'authenticated', 'authenticated', 'fin-admin@example.com'),
  (public.tmp_u('d2'), 'authenticated', 'authenticated', 'fin-editor@example.com'),
  (public.tmp_u('d3'), 'authenticated', 'authenticated', 'fin-so-ver@example.com'),
  (public.tmp_u('d4'), 'authenticated', 'authenticated', 'fin-sem-permissao@example.com'),
  (public.tmp_u('d5'), 'authenticated', 'authenticated', 'fin-cliente@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  (public.tmp_u('d1'), 'admin', 'Admin Financeiro', true, false),
  (public.tmp_u('d2'), 'equipe', 'Editor Financeiro', true, false),
  (public.tmp_u('d3'), 'equipe', 'Só Ver Financeiro', true, false),
  (public.tmp_u('d4'), 'equipe', 'Sem Permissão Financeiro', true, false),
  (public.tmp_u('d5'), 'cliente', 'Cliente Financeiro', true, false);

insert into public.equipe_permissoes (profile_id, permissao)
values
  (public.tmp_u('d2'), 'financeiro.ver'),
  (public.tmp_u('d2'), 'empreendimentos.ver'),
  (public.tmp_u('d3'), 'financeiro.ver');
insert into public.equipe_permissoes (profile_id, permissao)
values
  (public.tmp_u('d2'), 'financeiro.editar'),
  (public.tmp_u('d2'), 'empreendimentos.editar');

insert into public.empreendimentos (id, nome, codigo_pasta)
values
  (public.tmp_u('e001'), 'Empreendimento Financeiro Um', '940001'),
  (public.tmp_u('e002'), 'Empreendimento Financeiro Dois', '940002');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values (public.tmp_u('e001'), public.tmp_u('d5'));

select public.tmp_novo_projeto(public.tmp_u('e001'), '01', 'Projeto SAA Financeiro', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e001'), '02', 'Projeto OS Financeiro', 'termo');
select public.tmp_novo_projeto(public.tmp_u('e001'), '03', 'Projeto Doação Financeiro', 'doacao');
select public.tmp_novo_projeto(public.tmp_u('e001'), '06', 'Projeto Desfazer Financeiro', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e001'), '07', 'Projeto LAN Financeiro', 'saa');
select public.tmp_novo_projeto(public.tmp_u('e002'), '04', 'Projeto SAA Outro Empreendimento', 'saa');

insert into public.fornecedores (id, razao_social) values (public.tmp_u('f001'), 'Fornecedor Financeiro Teste');

-- Documentos: 1 contrato válido, 2 orçamento no título, 3 "orcamento" só no caminho, 4 de outro empreendimento,
-- 5 não é PDF, 6 da pasta de orçamentos, 8 contrato válido para o salvar.
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, grupo)
values
  (public.tmp_doc(1), public.tmp_u('e001'), 'Contrato 940101C assinado', public.tmp_u('e001')::text || '/' || public.tmp_doc(1)::text || '.pdf', 'application/pdf', 100, null),
  (public.tmp_doc(2), public.tmp_u('e001'), 'Orçamento ABA Consultorias', public.tmp_u('e001')::text || '/' || public.tmp_doc(2)::text || '.pdf', 'application/pdf', 100, null),
  (public.tmp_doc(3), public.tmp_u('e001'), 'Proposta comercial', public.tmp_u('e001')::text || '/ORCAMENTO-' || public.tmp_doc(3)::text || '.pdf', 'application/pdf', 100, null),
  (public.tmp_doc(4), public.tmp_u('e002'), 'Contrato de outro empreendimento', public.tmp_u('e002')::text || '/' || public.tmp_doc(4)::text || '.pdf', 'application/pdf', 100, null),
  (public.tmp_doc(5), public.tmp_u('e001'), 'Foto do contrato', public.tmp_u('e001')::text || '/' || public.tmp_doc(5)::text || '.png', 'image/png', 100, null),
  (public.tmp_doc(6), public.tmp_u('e001'), 'Documento da pasta de orçamentos', public.tmp_u('e001')::text || '/' || public.tmp_doc(6)::text || '.pdf', 'application/pdf', 100, 'orcamentos'),
  (public.tmp_doc(8), public.tmp_u('e001'), 'Contrato 940101C.2 assinado', public.tmp_u('e001')::text || '/' || public.tmp_doc(8)::text || '.pdf', 'application/pdf', 100, null);

-- Os eventos das etapas são gravados por um constraint trigger adiado (no commit). Como o teste termina em ROLLBACK,
-- ele é antecipado: ele passa a rodar ao fim de cada UPDATE de etapa.
set constraints all immediate;

-- ---------------------------------------------------------------------------
-- 1. Restrições do banco (itens, projetos do contrato, parcelas)
-- ---------------------------------------------------------------------------

-- Modo interno (como salvar_contrato_portal faz) para testar as restrições de formato sem passar pela função; a
-- recusa da escrita direta dos campos do contrato está na seção 11.
select set_config('aba.financeiro_interno', '1', true);

select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos, codigo) values (public.tmp_u('e001'), 'Código curto', 1000, '26070C')$q$,
  array['23514'], 'código com menos de 6 dígitos é recusado');
select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos, codigo) values (public.tmp_u('e001'), 'Código minúsculo', 1000, '940199c')$q$,
  array['23514'], 'código em minúscula é recusado');
select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos, codigo, versao) values (public.tmp_u('e001'), 'Versão zero', 1000, '940199C', 0)$q$,
  array['23514'], 'versão menor que 1 é recusada');
select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos, codigo) values (public.tmp_u('e001'), public.tmp_u('f001'), 'Fornecedor com código', 1000, '940198C')$q$,
  array['23514'], 'item de fornecedor não leva código de contrato');
select public.tmp_exige_ok(
  $q$insert into public.itens_financeiros (id, empreendimento_id, descricao, valor_contratado_centavos, codigo) values (public.tmp_u('1b01'), public.tmp_u('e001'), 'Contrato base dos testes de restrição', 1000, '940190C')$q$,
  'contrato com código válido é aceito');
select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos, codigo) values (public.tmp_u('e002'), 'Código repetido', 1000, '940190C')$q$,
  array['23505'], 'código duplicado é recusado (mesmo em outro empreendimento)');

-- Documento do contrato.
select public.tmp_exige_ok(
  $q$update public.itens_financeiros set documento_id = public.tmp_doc(1) where id = public.tmp_u('1b01')$q$,
  'PDF do mesmo empreendimento é aceito como documento do contrato');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set documento_id = public.tmp_doc(2) where id = public.tmp_u('1b01')$q$,
  array['23514'], 'documento com ORÇAMENTO no título é recusado');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set documento_id = public.tmp_doc(3) where id = public.tmp_u('1b01')$q$,
  array['23514'], 'documento com ORCAMENTO no caminho é recusado');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set documento_id = public.tmp_doc(6) where id = public.tmp_u('1b01')$q$,
  array['23514'], 'documento da pasta de orçamentos é recusado');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set documento_id = public.tmp_doc(4) where id = public.tmp_u('1b01')$q$,
  array['23514'], 'documento de outro empreendimento é recusado');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set documento_id = public.tmp_doc(5) where id = public.tmp_u('1b01')$q$,
  array['23514'], 'documento que não é PDF é recusado');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set documento_id = gen_random_uuid() where id = public.tmp_u('1b01')$q$,
  array['23514', '23503'], 'documento inexistente é recusado');
select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos, codigo, documento_id) values (public.tmp_u('e001'), 'Nasce com orçamento', 1000, '940197C', public.tmp_doc(2))$q$,
  array['23514'], 'item novo já com documento de orçamento é recusado');

delete from public.documentos where id = public.tmp_doc(1);
select public.tmp_exige_verdade(
  $q$select documento_id is null from public.itens_financeiros where id = public.tmp_u('1b01')$q$,
  'apagar o documento do contrato deixa o contrato sem documento (set null não é bloqueado)');

-- Projetos do contrato.
select public.tmp_exige_erro(
  $q$insert into public.item_financeiro_projetos (item_id, projeto_id) values (public.tmp_u('1b01'), public.tmp_p('04'))$q$,
  array['23514'], 'projeto de outro empreendimento não entra no contrato');
select public.tmp_exige_ok(
  $q$insert into public.item_financeiro_projetos (item_id, projeto_id) values (public.tmp_u('1b01'), public.tmp_p('01'))$q$,
  'projeto do mesmo empreendimento entra no contrato');
select public.tmp_exige_erro(
  $q$insert into public.item_financeiro_projetos (item_id, projeto_id) values (public.tmp_u('1b01'), public.tmp_p('01'))$q$,
  array['23505'], 'o mesmo projeto não entra duas vezes');
select set_config('aba.financeiro_interno', '', true);

insert into public.itens_financeiros (id, empreendimento_id, fornecedor_id, descricao, valor_contratado_centavos)
values (public.tmp_u('1f01'), public.tmp_u('e002'), public.tmp_u('f001'), 'Item do fornecedor', 5000000);
select public.tmp_exige_erro(
  $q$insert into public.item_financeiro_projetos (item_id, projeto_id) values (public.tmp_u('1f01'), public.tmp_p('04'))$q$,
  array['23514'], 'item de fornecedor não tem projetos de contrato');

-- Parcelas: checks do gatilho. O insert de parcela por evento só passa no modo interno, então os checks são provados nele.
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho) values (public.tmp_u('1b01'), 100, 'data')$q$,
  array['23514'], 'parcela de data fixa sem vencimento é recusada');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, vencimento, dias_apos) values (public.tmp_u('1b01'), 100, current_date, 5)$q$,
  array['23514'], 'parcela de data fixa com dias após é recusada');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, vencimento, gatilho) values (public.tmp_u('1b01'), 100, current_date, 'quando der')$q$,
  array['23514'], 'gatilho fora da lista é recusado');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo) values (public.tmp_u('1b01'), 100, 'evento', 'entrega')$q$,
  array['P0001'], 'insert de parcela por evento fora das funções é recusado (nem o postgres escapa)');

select set_config('aba.financeiro_interno', '1', true);
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo) values (public.tmp_u('1b01'), 100, 'evento', 'protocolo')$q$,
  array['23514'], 'protocolo sem projeto é recusado');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo) values (public.tmp_u('1b01'), 100, 'evento', 'outro')$q$,
  array['23514'], 'evento outro sem descrição é recusado');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo, evento_descricao) values (public.tmp_u('1b01'), 100, 'evento', 'entrega', 'Texto')$q$,
  array['23514'], 'descrição só vale no evento outro');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo, evento_projeto_id) values (public.tmp_u('1b01'), 100, 'evento', 'doacoes_protocolo', public.tmp_p('01'))$q$,
  array['23514'], 'projeto só vale em protocolo, aprovação e entrega');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo, dias_apos) values (public.tmp_u('1b01'), 100, 'evento', 'entrega', 3651)$q$,
  array['23514'], 'mais de 3650 dias é recusado');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo, numero) values (public.tmp_u('1b01'), 100, 'evento', 'entrega', 0)$q$,
  array['23514'], 'número da parcela menor que 1 é recusado');
select public.tmp_exige_ok(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo, numero) values (public.tmp_u('1b01'), 100, 'evento', 'entrega', 1)$q$,
  'parcela por evento válida (modo interno)');
select set_config('aba.financeiro_interno', '', true);

select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, vencimento, numero) values (public.tmp_u('1b01'), 100, current_date, 2), (public.tmp_u('1b01'), 100, current_date, 2)$q$,
  array['23505'], 'duas parcelas com o mesmo número no contrato são recusadas');

-- O contrato base some com as parcelas e os projetos (cascade) sem atrapalhar o resto.
delete from public.itens_financeiros where id = public.tmp_u('1b01');
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_u('1b01')$q$, 0, 'apagar o contrato apaga as parcelas, mesmo as por evento');

select set_config('aba.financeiro_interno', '', true);

-- ---------------------------------------------------------------------------
-- 2. Salvar contrato: 3 parcelas (data, assinatura + 0, aprovação do projeto + 30)
-- ---------------------------------------------------------------------------

select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(
       null, public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 30,
         jsonb_build_array(
           public.tmp_parcela('Entrada', 5000000, 'data', public.tmp_hoje() + 60),
           public.tmp_parcela('Na assinatura', 3000000, 'evento', null, 'assinatura', null, null, 0),
           public.tmp_parcela('Aprovação da OS', 2000000, 'evento', null, 'aprovacao', public.tmp_p('02'), null, 30)),
         jsonb_build_array(public.tmp_p('01'), public.tmp_p('02'))),
       null)$q$,
  'salvar contrato novo com 3 parcelas');
select public.tmp_como('postgres');
set constraints all immediate;

select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.itens_financeiros i where i.codigo = '940101C' and i.empreendimento_id = public.tmp_u('e001')
       and i.fornecedor_id is null and i.versao = 1 and i.assinado_em = public.tmp_hoje() - 30 and i.valor_contratado_centavos = 10000000)$q$,
  'o contrato foi gravado sem fornecedor, com versão, assinatura e valor');
select public.tmp_exige_texto(
  $q$select string_agg(numero::text || ':' || gatilho, ',' order by numero) from public.parcelas where item_id = public.tmp_item('940101C')$q$,
  '1:data,2:evento,3:evento', 'as parcelas ficam numeradas pela posição');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() + 60 and evento_id is null from public.parcelas where id = public.tmp_pid('940101C', 1)$q$,
  'parcela de data fixa guarda o vencimento informado');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 30 and evento_id is not null from public.parcelas where id = public.tmp_pid('940101C', 2)$q$,
  'parcela na assinatura (+0) vence na data da assinatura');
select public.tmp_exige_verdade(
  $q$select vencimento is null and evento_id is null and evento_projeto_id = public.tmp_p('02') and dias_apos = 30
       from public.parcelas where id = public.tmp_pid('940101C', 3)$q$,
  'parcela na aprovação do projeto aguarda o evento (sem vencimento)');
select public.tmp_exige_conta(
  $q$select count(*) from public.item_financeiro_projetos where item_id = public.tmp_item('940101C')$q$, 2, 'o contrato guarda os dois projetos');
select public.tmp_exige_verdade(
  $q$select exists (select 1 from public.financeiro_eventos e where e.tipo = 'assinatura' and e.item_id = public.tmp_item('940101C')
       and e.origem = 'contrato' and e.ocorrido_em = public.tmp_hoje() - 30 and e.desfeito_em is null
       and e.criado_por = public.tmp_u('d2') and e.empreendimento_id = public.tmp_u('e001'))$q$,
  'a assinatura virou evento de origem contrato, criado por quem salvou');

-- ---------------------------------------------------------------------------
-- 3. Contrato de eventos variados (940102C) para os testes de etapas e botões
-- ---------------------------------------------------------------------------

select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(
       null, public.tmp_u('e001'),
       public.tmp_dados('940102C', null,
         jsonb_build_array(
           public.tmp_parcela('Protocolo + 10', 1000000, 'evento', null, 'protocolo', public.tmp_p('06'), null, 10),
           public.tmp_parcela('Entrega do projeto', 1000000, 'evento', null, 'entrega', public.tmp_p('06'), null, 0),
           public.tmp_parcela('Doações no protocolo + 15', 1000000, 'evento', null, 'doacoes_protocolo', null, null, 15),
           public.tmp_parcela('Entrega do contrato', 1000000, 'evento', null, 'entrega', null, null, 0),
           public.tmp_parcela('Medição + 5', 1000000, 'evento', null, 'outro', null, 'Medição final', 5),
           public.tmp_parcela('Parcela final', 1000000, 'data', public.tmp_hoje() + 90)),
         jsonb_build_array(public.tmp_p('06')), null, 2),
       null)$q$,
  'salvar contrato com eventos variados');
select public.tmp_como('postgres');
set constraints all immediate;
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_item('940102C') and gatilho = 'evento' and vencimento is null$q$,
  5, 'as cinco parcelas por evento aguardam');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where item_id = public.tmp_item('940102C')$q$,
  0, 'sem assinatura informada não há evento de assinatura');

-- ---------------------------------------------------------------------------
-- 4. Permissões
-- ---------------------------------------------------------------------------

-- Eventos para os testes de leitura: um botão qualquer (doações) e outro desfeito depois.
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'tro_pedido', public.tmp_hoje() - 2)$q$,
  'marcar um evento de TRO para os testes de leitura');
select public.tmp_como('postgres');

-- E2: contrato da ABA para o "A cobrar" e para provar que o cliente de E1 não o lê (montado direto, em modo interno).
select set_config('aba.financeiro_interno', '1', true);
insert into public.itens_financeiros (id, empreendimento_id, descricao, valor_contratado_centavos, codigo, versao)
values (public.tmp_u('1c04'), public.tmp_u('e002'), 'Contrato Cobrança', 1000000, '940104C', 2);
select set_config('aba.financeiro_interno', '', true);
insert into public.parcelas (item_id, numero, nome, valor_previsto_centavos, vencimento, data_pagamento, valor_pago_centavos)
values
  (public.tmp_u('1c04'), 1, 'Vencida', 100000, public.tmp_hoje() - 5, null, 0),
  (public.tmp_u('1c04'), 2, 'A vencer em 10 dias', 200000, public.tmp_hoje() + 10, null, 0),
  (public.tmp_u('1c04'), 3, 'A vencer em 20 dias', 300000, public.tmp_hoje() + 20, null, 0),
  (public.tmp_u('1c04'), 4, 'Paga', 400000, public.tmp_hoje() - 2, public.tmp_hoje() - 2, 400000),
  (public.tmp_u('1c04'), 5, 'Parcial', 500000, public.tmp_hoje() + 1, null, 150000),
  (public.tmp_u('1c04'), 6, 'Vence hoje', 600000, public.tmp_hoje(), null, 0);
select set_config('aba.financeiro_interno', '1', true);
insert into public.parcelas (item_id, numero, nome, valor_previsto_centavos, gatilho, evento_tipo)
values (public.tmp_u('1c04'), 7, 'Aguardando evento', 700000, 'evento', 'doacoes_liberacao');
select set_config('aba.financeiro_interno', '', true);
insert into public.parcelas (item_id, numero, nome, valor_previsto_centavos, vencimento)
values (public.tmp_u('1f01'), 1, 'Parcela do fornecedor', 100000, public.tmp_hoje() - 30);

-- Sem financeiro.ver (equipe sem permissão).
select public.tmp_como('d4');
select public.tmp_exige_conta($q$select count(*) from public.financeiro_eventos$q$, 0, 'sem financeiro.ver não lê eventos');
select public.tmp_exige_conta($q$select count(*) from public.itens_financeiros$q$, 0, 'sem financeiro.ver não lê itens');
select public.tmp_exige_conta($q$select count(*) from public.parcelas$q$, 0, 'sem financeiro.ver não lê parcelas');
select public.tmp_exige_conta($q$select count(*) from public.item_financeiro_projetos$q$, 0, 'sem financeiro.ver não lê os projetos do contrato');
select public.tmp_exige_erro($q$select count(*) from public.listar_a_cobrar(15)$q$, array['42501'], 'sem financeiro.ver não usa o "A cobrar"');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'tro_pedido', public.tmp_hoje() - 1)$q$,
  array['42501'], 'sem permissão não marca evento');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940150C', null, '[]'::jsonb), null)$q$,
  array['42501'], 'sem permissão não salva contrato');

-- Só financeiro.ver.
select public.tmp_como('d3');
select public.tmp_exige_maior($q$select count(*) from public.financeiro_eventos$q$, 1, 'financeiro.ver lê os eventos');
select public.tmp_exige_conta(
  $q$select count(*) from public.item_financeiro_projetos where item_id = public.tmp_item('940101C')$q$, 2, 'financeiro.ver lê os projetos do contrato');
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_item('940101C')$q$, 3, 'financeiro.ver lê as parcelas');
select public.tmp_exige_ok($q$select count(*) from public.listar_a_cobrar(15)$q$, 'financeiro.ver usa o "A cobrar"');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940150C', null, '[]'::jsonb), null)$q$,
  array['42501'], 'só ver não salva contrato');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(public.tmp_item('940101C'), public.tmp_u('e001'), public.tmp_dados('940101C', null, '[]'::jsonb), public.tmp_atual('940101C'))$q$,
  array['42501'], 'só ver não edita contrato');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'tro_liberacao', public.tmp_hoje() - 1)$q$,
  array['42501'], 'só ver não marca evento');
select public.tmp_exige_erro(
  $q$select public.desfazer_evento_financeiro((select id from public.financeiro_eventos where tipo = 'tro_pedido' and empreendimento_id = public.tmp_u('e001') and desfeito_em is null))$q$,
  array['42501'], 'só ver não desfaz evento');
select public.tmp_exige_negado(
  $q$update public.parcelas set nome = 'Mudou' where item_id = public.tmp_item('940101C')$q$, 'só ver não edita parcela direto');

-- Cliente do empreendimento E1.
select public.tmp_como('d5');
select public.tmp_exige_verdade(
  $q$select count(*) filter (where codigo = '940101C') = 1 and count(*) filter (where empreendimento_id = public.tmp_u('e002')) = 0 from public.itens_financeiros$q$,
  'cliente lê o contrato do seu empreendimento e nenhum de outro');
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_item('940101C')$q$, 3, 'cliente lê as parcelas do contrato do seu empreendimento');
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_u('1c04')$q$, 0, 'cliente não lê parcelas de outro empreendimento');
select public.tmp_exige_conta(
  $q$select count(*) from public.item_financeiro_projetos where item_id = public.tmp_item('940101C')$q$, 2, 'cliente lê os projetos do contrato do seu empreendimento');
select public.tmp_exige_conta(
  $q$select count(*) from public.item_financeiro_projetos where item_id in (select id from public.itens_financeiros where empreendimento_id = public.tmp_u('e002'))$q$,
  0, 'cliente não lê projetos de contrato de outro empreendimento');
select public.tmp_exige_conta($q$select count(*) from public.financeiro_eventos$q$, 0, 'cliente não lê eventos');
select public.tmp_exige_erro($q$select count(*) from public.listar_a_cobrar(15)$q$, array['42501'], 'cliente não usa o "A cobrar"');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940150C', null, '[]'::jsonb), null)$q$,
  array['42501'], 'cliente não salva contrato');

-- Anônimo.
select public.tmp_como('anon');
select public.tmp_exige_erro($q$select count(*) from public.financeiro_eventos$q$, array['42501'], 'anon não lê eventos');
select public.tmp_exige_erro($q$select count(*) from public.item_financeiro_projetos$q$, array['42501'], 'anon não lê os projetos do contrato');
select public.tmp_exige_erro($q$select count(*) from public.listar_a_cobrar(15)$q$, array['42501'], 'anon não usa o "A cobrar"');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), '{}'::jsonb, null)$q$, array['42501'], 'anon não salva contrato');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'tro_pedido', public.tmp_hoje())$q$, array['42501'], 'anon não marca evento');
select public.tmp_exige_erro(
  $q$select public.desfazer_evento_financeiro(gen_random_uuid())$q$, array['42501'], 'anon não desfaz evento');

-- Ninguém escreve direto nas duas tabelas novas (nem o editor, nem o admin) e as funções internas não são chamáveis.
select public.tmp_como('d2');
select public.tmp_exige_negado(
  $q$insert into public.financeiro_eventos (empreendimento_id, tipo, ocorrido_em, origem) values (public.tmp_u('e001'), 'tro_liberacao', public.tmp_hoje(), 'botao')$q$,
  'editor não insere evento direto');
select public.tmp_exige_negado($q$update public.financeiro_eventos set ocorrido_em = public.tmp_hoje()$q$, 'editor não altera evento direto');
select public.tmp_exige_negado($q$delete from public.financeiro_eventos$q$, 'editor não apaga evento direto');
select public.tmp_exige_negado(
  $q$insert into public.item_financeiro_projetos (item_id, projeto_id) values (public.tmp_item('940101C'), public.tmp_p('03'))$q$,
  'editor não insere projeto de contrato direto');
select public.tmp_exige_negado($q$delete from public.item_financeiro_projetos$q$, 'editor não apaga projeto de contrato direto');
select public.tmp_exige_erro(
  $q$select public.financeiro_recalcular_vencimentos(public.tmp_u('e001'))$q$, array['42501'], 'o recálculo não é chamável por usuário');
select public.tmp_exige_erro(
  $q$select public.financeiro_eventos_retroativos()$q$, array['42501'], 'a função dos eventos retroativos não é chamável por usuário');
select public.tmp_como('d1');
select public.tmp_exige_negado(
  $q$insert into public.financeiro_eventos (empreendimento_id, tipo, ocorrido_em, origem) values (public.tmp_u('e001'), 'tro_liberacao', public.tmp_hoje(), 'botao')$q$,
  'admin também não insere evento direto');
select public.tmp_exige_negado($q$delete from public.item_financeiro_projetos$q$, 'admin também não apaga projeto de contrato direto');
select public.tmp_como('postgres');

-- ---------------------------------------------------------------------------
-- 5. Parcelas: o editor antigo (REST) continua registrando pagamento, mas não mexe no gatilho
-- ---------------------------------------------------------------------------

select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$insert into public.parcelas (item_id, valor_previsto_centavos, gatilho, evento_tipo) values (public.tmp_item('940101C'), 100, 'evento', 'assinatura')$q$,
  array['P0001'], 'insert direto de parcela com gatilho evento é recusado');
select public.tmp_exige_erro(
  $q$update public.parcelas set vencimento = public.tmp_hoje() + 5 where id = public.tmp_pid('940101C', 3)$q$,
  array['P0001'], 'update direto do vencimento de parcela por evento aguardando é recusado');
select public.tmp_exige_erro(
  $q$update public.parcelas set vencimento = public.tmp_hoje() + 5 where id = public.tmp_pid('940101C', 2)$q$,
  array['P0001'], 'update direto do vencimento de parcela por evento já calculada é recusado');
select public.tmp_exige_erro(
  $q$update public.parcelas set gatilho = 'evento', evento_tipo = 'entrega', vencimento = null where id = public.tmp_pid('940101C', 1)$q$,
  array['P0001'], 'update direto não transforma parcela de data em parcela por evento');
select public.tmp_exige_erro(
  $q$update public.parcelas set dias_apos = 5 where id = public.tmp_pid('940101C', 3)$q$,
  array['P0001'], 'update direto dos dias após é recusado');
select public.tmp_exige_erro(
  $q$update public.parcelas set evento_id = null, dias_apos = 1 where id = public.tmp_pid('940101C', 2)$q$,
  array['P0001'], 'update direto de evento_id junto com outra mudança é recusado');
select public.tmp_exige_erro(
  $q$update public.parcelas set evento_id = public.tmp_u('00') where id = public.tmp_pid('940101C', 1)$q$,
  array['P0001', '23503'], 'update direto não aponta a parcela para um evento');
select public.tmp_exige_erro(
  $q$update public.parcelas set numero = 9 where id = public.tmp_pid('940101C', 1)$q$,
  array['P0001'], 'update direto do número é recusado');
select public.tmp_exige_ok(
  $q$update public.parcelas set vencimento = public.tmp_hoje() + 70, nome = 'Entrada (editada)' where id = public.tmp_pid('940101C', 1)$q$,
  'update direto de vencimento e nome de parcela de data fixa continua valendo');
select public.tmp_exige_ok(
  $q$update public.parcelas set data_pagamento = public.tmp_hoje(), valor_pago_centavos = 3000000 where id = public.tmp_pid('940101C', 2)$q$,
  'registrar pagamento de parcela por evento continua valendo');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 30 and valor_pago_centavos = 3000000 and data_pagamento = public.tmp_hoje()
       from public.parcelas where id = public.tmp_pid('940101C', 2)$q$,
  'o pagamento ficou gravado e o vencimento da parcela por evento não mudou');

-- ---------------------------------------------------------------------------
-- 6. Eventos das etapas
-- ---------------------------------------------------------------------------

-- OS (marcos: 2 análise, 3 aprovado): a conclusão da etapa 1 vira a data do protocolo.
select public.tmp_concluida('02', 1, public.tmp_hoje() - 20);
select public.tmp_mover('02', 2);
select public.tmp_exige_verdade(
  $q$select exists (
       select 1 from public.financeiro_eventos e join public.projeto_etapa_historico h on h.id = e.historico_id
        where e.tipo = 'protocolo' and e.projeto_id = public.tmp_p('02') and e.desfeito_em is null
          and e.ocorrido_em = public.tmp_hoje() - 20 and e.origem = 'etapas' and e.empreendimento_id = public.tmp_u('e001')
          and h.para_etapa_id = public.tmp_e('02', 2))$q$,
  'chegar à análise gera o protocolo com a conclusão da etapa anterior, ligado ao histórico');
select public.tmp_exige_verdade(
  $q$select exists (
       select 1 from public.financeiro_eventos e
        where e.tipo = 'entrega' and e.projeto_id = public.tmp_p('02') and e.desfeito_em is null
          and e.ocorrido_em = public.tmp_hoje() - 20 and e.origem = 'protocolo' and e.historico_id is not null)$q$,
  'o primeiro protocolo gera a entrega do projeto, de origem protocolo');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo = 'aprovacao' and projeto_id = public.tmp_p('02')$q$, 0,
  'em análise ainda não há aprovação');
select public.tmp_exige_verdade(
  $q$select vencimento is null from public.parcelas where id = public.tmp_pid('940101C', 3)$q$,
  'a parcela da aprovação continua aguardando');

select public.tmp_concluida('02', 3, public.tmp_hoje() - 5);
select public.tmp_mover('02', 3);
select public.tmp_exige_verdade(
  $q$select exists (
       select 1 from public.financeiro_eventos e
        where e.tipo = 'aprovacao' and e.projeto_id = public.tmp_p('02') and e.desfeito_em is null
          and e.ocorrido_em = public.tmp_hoje() - 5 and e.origem = 'etapas')$q$,
  'chegar à aprovada gera a aprovação com a conclusão da etapa');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() + 25
       and evento_id = (select id from public.financeiro_eventos where tipo = 'aprovacao' and projeto_id = public.tmp_p('02') and desfeito_em is null)
       from public.parcelas where id = public.tmp_pid('940101C', 3)$q$,
  'aprovação do projeto + 30 dias calcula o vencimento da parcela');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo in ('protocolo', 'entrega') and projeto_id = public.tmp_p('02')$q$, 2,
  'ir da análise à aprovação não duplica o protocolo nem a entrega');

-- SAA com sinal: a data do arquivo vence a data de conclusão.
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho)
values (public.tmp_doc(7), public.tmp_u('e001'), 'Protocolo da Copasa', public.tmp_u('e001')::text || '/' || public.tmp_doc(7)::text || '.pdf', 'application/pdf', 100);
insert into public.etapa_sinais (id, empreendimento_id, projeto_id, documento_id, tipo, data_arquivo)
values (public.tmp_u('5e01'), public.tmp_u('e001'), public.tmp_p('01'), public.tmp_doc(7), 'protocolo', public.tmp_meiodia(public.tmp_hoje() - 45));
select public.tmp_concluida('01', 2, public.tmp_hoje() - 44);
select public.tmp_mover('01', 3, 'sugestao', public.tmp_u('5e01'));
select public.tmp_exige_verdade(
  $q$select exists (
       select 1 from public.financeiro_eventos e
        where e.tipo = 'protocolo' and e.projeto_id = public.tmp_p('01') and e.desfeito_em is null and e.ocorrido_em = public.tmp_hoje() - 45)$q$,
  'mudança vinda de sinal usa o dia do arquivo (Brasília)');

-- LAN: voltar para Em confecção e protocolar de novo não muda a data do protocolo.
select public.tmp_concluida('07', 2, public.tmp_hoje() - 10);
select public.tmp_mover('07', 3);
select public.tmp_exige_verdade(
  $q$select ocorrido_em = public.tmp_hoje() - 10 from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('07') and desfeito_em is null$q$,
  'primeiro protocolo do projeto LAN');
select public.tmp_concluida('07', 2, null);
select public.tmp_mover('07', 2);
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('07') and desfeito_em is null$q$, 1,
  'voltar para confecção (LAN) não desfaz o protocolo');
select public.tmp_concluida('07', 2, public.tmp_hoje() - 2);
select public.tmp_mover('07', 3);
select public.tmp_exige_verdade(
  $q$select count(*) = 1 and min(ocorrido_em) = public.tmp_hoje() - 10 from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('07')$q$,
  'novo protocolo depois da LAN não muda a data nem cria outro evento');

-- Projeto sem marco não gera nada.
select public.tmp_mover('03', 2);
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('03')$q$, 0, 'projeto sem marco não gera evento');

-- Desfazer a mudança de etapa desfaz os eventos dela; a parcela volta a aguardar; avançar de novo recria.
select public.tmp_concluida('06', 2, public.tmp_hoje() - 12);
select public.tmp_mover('06', 3, 'sugestao');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 2 and evento_id is not null from public.parcelas where id = public.tmp_pid('940102C', 1)$q$,
  'protocolo do projeto + 10 dias calcula o vencimento');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 12 from public.parcelas where id = public.tmp_pid('940102C', 2)$q$,
  'a entrega do projeto (criada junto com o protocolo) calcula o vencimento da parcela de entrega do projeto');
select public.tmp_exige_verdade(
  $q$select vencimento is null from public.parcelas where id = public.tmp_pid('940102C', 4)$q$,
  'a entrega do projeto não vale para a parcela de entrega do contrato');

select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.desfazer_etapa((select id from public.projeto_etapa_historico where projeto_id = public.tmp_p('06') and origem = 'sugestao' and desfeito_em is null))$q$,
  'desfazer a mudança de etapa do projeto');
select public.tmp_como('postgres');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('06') and desfeito_em is null$q$, 0,
  'desfazer a etapa desfaz o protocolo e a entrega que ela criou');
select public.tmp_exige_verdade(
  $q$select count(*) = 2 and bool_and(desfeito_por = public.tmp_u('d2')) from public.financeiro_eventos where projeto_id = public.tmp_p('06')$q$,
  'os eventos desfeitos guardam quem desfez');
select public.tmp_exige_verdade(
  $q$select vencimento is null and evento_id is null from public.parcelas where id = public.tmp_pid('940102C', 1)$q$,
  'sem o evento a parcela do protocolo volta a aguardar');
select public.tmp_exige_verdade(
  $q$select vencimento is null and evento_id is null from public.parcelas where id = public.tmp_pid('940102C', 2)$q$,
  'sem o evento a parcela da entrega volta a aguardar');

select public.tmp_mover('06', 3);
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 2 from public.parcelas where id = public.tmp_pid('940102C', 1)$q$,
  'avançar a etapa de novo recria o evento e o vencimento');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('06') and desfeito_em is null$q$, 2,
  'protocolo e entrega voltam a valer');

-- ---------------------------------------------------------------------------
-- 7. Botões: marcar e desfazer evento
-- ---------------------------------------------------------------------------

select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_protocolo', public.tmp_hoje() - 3)$q$,
  'marcar o protocolo das doações');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select e.origem = 'botao' and e.criado_por = public.tmp_u('d2') and e.projeto_id is null and e.item_id is null and e.parcela_id is null
       from public.financeiro_eventos e where e.tipo = 'doacoes_protocolo' and e.empreendimento_id = public.tmp_u('e001') and e.desfeito_em is null$q$,
  'o evento do empreendimento nasce de origem botão, sem alvo, com quem marcou');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() + 12 from public.parcelas where id = public.tmp_pid('940102C', 3)$q$,
  'doações + 15 dias calcula o vencimento');

select public.tmp_como('d2');
select public.tmp_exige_mensagem(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_protocolo', public.tmp_hoje() - 1)$q$,
  'Já marcado em ' || to_char((select public.tmp_hoje() - 3), 'DD/MM/YYYY'),
  'marcar de novo sem confirmação mostra a data já marcada');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_protocolo', public.tmp_hoje() - 1)$q$,
  array['P0001'], 'marcar de novo sem substituir é recusado');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_protocolo', public.tmp_hoje() - 1, null, null, null, true)$q$,
  'substituir a data de um evento marcado');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select count(*) filter (where desfeito_em is null) = 1 and count(*) = 2
       and min(ocorrido_em) filter (where desfeito_em is null) = public.tmp_hoje() - 1
       from public.financeiro_eventos where tipo = 'doacoes_protocolo' and empreendimento_id = public.tmp_u('e001')$q$,
  'substituir desfaz o antigo e grava o novo');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() + 14 from public.parcelas where id = public.tmp_pid('940102C', 3)$q$,
  'o vencimento acompanha a data substituída');

select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'entrega', public.tmp_hoje() - 4, null, public.tmp_item('940102C'))$q$,
  'marcar a entrega do contrato');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'outro', public.tmp_hoje() - 6, null, null, public.tmp_pid('940102C', 5))$q$,
  'marcar o evento "outro" de uma parcela');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 4 from public.parcelas where id = public.tmp_pid('940102C', 4)$q$,
  'a entrega marcada no contrato calcula a parcela de entrega do contrato');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 1 from public.parcelas where id = public.tmp_pid('940102C', 5)$q$,
  'o evento outro + 5 dias calcula a parcela');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 12 from public.parcelas where id = public.tmp_pid('940102C', 2)$q$,
  'a entrega do contrato não mexe na parcela de entrega do projeto');

-- Alvos e datas inválidos.
select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'assinatura', public.tmp_hoje() - 1, null, public.tmp_item('940101C'))$q$,
  array['P0001'], 'assinatura não se marca por botão');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_liberacao', public.tmp_hoje() + 1)$q$,
  array['P0001'], 'data no futuro é recusada');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_liberacao', date '1999-12-31')$q$,
  array['P0001'], 'data antes de 2000 é recusada');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'protocolo', public.tmp_hoje() - 1)$q$,
  array['22023'], 'protocolo exige projeto');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'doacoes_liberacao', public.tmp_hoje() - 1, public.tmp_p('01'))$q$,
  array['22023'], 'evento do empreendimento não leva projeto');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'entrega', public.tmp_hoje() - 1, public.tmp_p('01'), public.tmp_item('940101C'))$q$,
  array['22023'], 'entrega é de projeto ou de contrato, não dos dois');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'inventado', public.tmp_hoje() - 1)$q$,
  array['22023'], 'tipo desconhecido é recusado');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'protocolo', public.tmp_hoje() - 1, public.tmp_p('04'))$q$,
  array['P0001'], 'projeto de outro empreendimento é recusado');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'entrega', public.tmp_hoje() - 1, null, public.tmp_u('1c04'))$q$,
  array['P0001'], 'contrato de outro empreendimento é recusado');
select public.tmp_exige_erro(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'outro', public.tmp_hoje() - 1, null, null, public.tmp_pid('940102C', 6))$q$,
  array['P0001'], 'o evento outro só vale para parcela que o aguarda');

-- Desfazer.
select public.tmp_exige_ok(
  $q$select public.desfazer_evento_financeiro((select id from public.financeiro_eventos where tipo = 'doacoes_protocolo' and empreendimento_id = public.tmp_u('e001') and desfeito_em is null))$q$,
  'desfazer o evento de doações');
select public.tmp_exige_erro(
  $q$select public.desfazer_evento_financeiro((select id from public.financeiro_eventos where tipo = 'doacoes_protocolo' and empreendimento_id = public.tmp_u('e001') order by criado_em desc limit 1))$q$,
  array['P0001'], 'desfazer um evento já desfeito é recusado');
select public.tmp_exige_erro(
  $q$select public.desfazer_evento_financeiro((select id from public.financeiro_eventos where tipo = 'assinatura' and item_id = public.tmp_item('940101C') and desfeito_em is null))$q$,
  array['P0001'], 'a assinatura não se desfaz por botão');
select public.tmp_exige_erro($q$select public.desfazer_evento_financeiro(gen_random_uuid())$q$, array['P0001'], 'evento inexistente');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select vencimento is null and evento_id is null from public.parcelas where id = public.tmp_pid('940102C', 3)$q$,
  'desfazer o evento devolve a parcela ao estado de aguardando');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo = 'doacoes_protocolo' and empreendimento_id = public.tmp_u('e001') and desfeito_em is null$q$, 0,
  'não sobra evento de doações ativo');

-- ---------------------------------------------------------------------------
-- 8. Salvar contrato: edição, assinatura trocada, pagamento, concorrência, validações
-- ---------------------------------------------------------------------------

-- Atenção: a parcela 2 (assinatura) está paga e a 1 teve o vencimento editado para hoje + 70.
select public.tmp_como('d2');

-- Assinatura trocada: o evento antigo é desfeito, o novo vale, o vencimento acompanha, o pagamento não muda.
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 20,
         jsonb_build_array(
           public.tmp_parcela('Entrada (editada)', 5000000, 'data', public.tmp_hoje() + 70, null, null, null, null, public.tmp_pid('940101C', 1)),
           public.tmp_parcela('Na assinatura', 3000000, 'evento', null, 'assinatura', null, null, 0, public.tmp_pid('940101C', 2)),
           public.tmp_parcela('Aprovação da OS', 2000000, 'evento', null, 'aprovacao', public.tmp_p('02'), null, 30, public.tmp_pid('940101C', 3))),
         jsonb_build_array(public.tmp_p('01'), public.tmp_p('02'))),
       public.tmp_atual('940101C'))$q$,
  'editar o contrato trocando a data de assinatura');
select public.tmp_como('postgres');
set constraints all immediate;
select public.tmp_exige_verdade(
  $q$select count(*) = 2 and count(*) filter (where desfeito_em is null) = 1
       and min(ocorrido_em) filter (where desfeito_em is null) = public.tmp_hoje() - 20
       from public.financeiro_eventos where tipo = 'assinatura' and item_id = public.tmp_item('940101C')$q$,
  'a assinatura trocada desfaz o evento antigo e grava o novo');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() - 20 from public.parcelas where id = public.tmp_pid('940101C', 2)$q$,
  'a assinatura trocada muda o vencimento da parcela');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() + 25 from public.parcelas where id = public.tmp_pid('940101C', 3)$q$,
  'a parcela cuja regra não mudou mantém o vencimento da aprovação');
select public.tmp_exige_verdade(
  $q$select valor_pago_centavos = 3000000 and data_pagamento = public.tmp_hoje() from public.parcelas where id = public.tmp_pid('940101C', 2)$q$,
  'salvar o contrato não mexe no pagamento');

-- Edição concorrente.
select public.tmp_como('d2');
select public.tmp_exige_mensagem(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 20, '[]'::jsonb), public.tmp_atual('940101C') - interval '1 minute')$q$,
  'O contrato foi alterado por outra pessoa%', 'edição com atualizado_em antigo é recusada');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(public.tmp_item('940101C'), public.tmp_u('e001'), public.tmp_dados('940101C', public.tmp_hoje() - 20, '[]'::jsonb), null)$q$,
  array['P0001'], 'editar sem informar o atualizado_em é recusado');

-- Parcela paga não some; a regra de projeto fora do contrato; parcela alheia.
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 20,
         jsonb_build_array(
           public.tmp_parcela('Entrada (editada)', 5000000, 'data', public.tmp_hoje() + 70, null, null, null, null, public.tmp_pid('940101C', 1)),
           public.tmp_parcela('Aprovação da OS', 2000000, 'evento', null, 'aprovacao', public.tmp_p('02'), null, 30, public.tmp_pid('940101C', 3))),
         jsonb_build_array(public.tmp_p('01'), public.tmp_p('02'))),
       public.tmp_atual('940101C'))$q$,
  array['P0001'], 'a parcela com pagamento não pode sumir do contrato');
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_item('940101C')$q$, 3,
  'a recusa não apagou nenhuma parcela');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 20,
         jsonb_build_array(
           public.tmp_parcela('Entrada (editada)', 5000000, 'data', public.tmp_hoje() + 70, null, null, null, null, public.tmp_pid('940101C', 1)),
           public.tmp_parcela('Na assinatura', 3000000, 'evento', null, 'assinatura', null, null, 0, public.tmp_pid('940101C', 2)),
           public.tmp_parcela('Aprovação da OS', 2000000, 'evento', null, 'aprovacao', public.tmp_p('02'), null, 30, public.tmp_pid('940101C', 3))),
         jsonb_build_array(public.tmp_p('01'))),
       public.tmp_atual('940101C'))$q$,
  array['P0001'], 'parcela de evento com projeto fora dos projetos do contrato é recusada');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 20,
         jsonb_build_array(public.tmp_parcela('Alheia', 100, 'data', public.tmp_hoje() + 1, null, null, null, null, public.tmp_pid('940102C', 6))),
         jsonb_build_array(public.tmp_p('01'))),
       public.tmp_atual('940101C'))$q$,
  array['P0001'], 'parcela de outro contrato é recusada');

-- Reordenar, incluir parcela nova e mudar o valor de uma parcela paga (o pago não muda).
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', public.tmp_hoje() - 20,
         jsonb_build_array(
           public.tmp_parcela('Aprovação da OS', 2000000, 'evento', null, 'aprovacao', public.tmp_p('02'), null, 30, public.tmp_pid('940101C', 3)),
           public.tmp_parcela('Entrada (editada)', 5000000, 'data', public.tmp_hoje() + 70, null, null, null, null, public.tmp_pid('940101C', 1)),
           public.tmp_parcela('Na assinatura', 3500000, 'evento', null, 'assinatura', null, null, 0, public.tmp_pid('940101C', 2)),
           public.tmp_parcela('Parcela nova', 500000, 'data', public.tmp_hoje() + 100)),
         jsonb_build_array(public.tmp_p('01'), public.tmp_p('02')), public.tmp_doc(8), 3),
       public.tmp_atual('940101C'))$q$,
  'reordenar parcelas, incluir uma nova e trocar versão e documento');
select public.tmp_como('postgres');
set constraints all immediate;
select public.tmp_exige_texto(
  $q$select string_agg(nome, ',' order by numero) from public.parcelas where item_id = public.tmp_item('940101C')$q$,
  'Aprovação da OS,Entrada (editada),Na assinatura,Parcela nova', 'a numeração segue a posição na lista e a parcela nova entra');
select public.tmp_exige_verdade(
  $q$select valor_previsto_centavos = 3500000 and valor_pago_centavos = 3000000 and data_pagamento = public.tmp_hoje() and numero = 3
       from public.parcelas where nome = 'Na assinatura' and item_id = public.tmp_item('940101C')$q$,
  'o valor previsto muda, o pagamento não');
select public.tmp_exige_verdade(
  $q$select versao = 3 and documento_id = public.tmp_doc(8) from public.itens_financeiros where codigo = '940101C'$q$,
  'versão e documento do contrato foram gravados');
select public.tmp_exige_verdade(
  $q$select vencimento = public.tmp_hoje() + 25 from public.parcelas where nome = 'Aprovação da OS' and item_id = public.tmp_item('940101C')$q$,
  'reordenar não desmancha o vencimento calculado');

-- Tirar a data de assinatura só desfaz o evento.
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(
       public.tmp_item('940101C'), public.tmp_u('e001'),
       public.tmp_dados('940101C', null,
         jsonb_build_array(
           public.tmp_parcela('Aprovação da OS', 2000000, 'evento', null, 'aprovacao', public.tmp_p('02'), null, 30, public.tmp_pid('940101C', 1)),
           public.tmp_parcela('Entrada (editada)', 5000000, 'data', public.tmp_hoje() + 70, null, null, null, null, public.tmp_pid('940101C', 2)),
           public.tmp_parcela('Na assinatura', 3500000, 'evento', null, 'assinatura', null, null, 0, public.tmp_pid('940101C', 3))),
         jsonb_build_array(public.tmp_p('01'), public.tmp_p('02')), public.tmp_doc(8), 3),
       public.tmp_atual('940101C'))$q$,
  'tirar a data de assinatura e a parcela nova do contrato');
select public.tmp_como('postgres');
set constraints all immediate;
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo = 'assinatura' and item_id = public.tmp_item('940101C') and desfeito_em is null$q$, 0,
  'sem data de assinatura não há evento de assinatura ativo');
select public.tmp_exige_verdade(
  $q$select vencimento is null and evento_id is null from public.parcelas where nome = 'Na assinatura' and item_id = public.tmp_item('940101C')$q$,
  'sem assinatura a parcela volta a aguardar (e o pagamento fica)');
select public.tmp_exige_conta(
  $q$select count(*) from public.parcelas where item_id = public.tmp_item('940101C')$q$, 3, 'a parcela nova sem pagamento saiu quando não veio na lista');

-- Validações do formato (22023) e das regras (P0001).
select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940101C', null, '[]'::jsonb), null)$q$,
  array['P0001'], 'código já usado por outro contrato é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb) - 'codigo', null)$q$,
  array['22023'], 'contrato sem código é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('26070C', null, '[]'::jsonb), null)$q$,
  array['22023'], 'código fora do formato é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb) || '{"extra": 1}'::jsonb, null)$q$,
  array['22023'], 'campo desconhecido é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', public.tmp_hoje() + 1, '[]'::jsonb), null)$q$,
  array['22023'], 'assinatura no futuro é recusada');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb) || '{"valor_contratado_centavos": "-5"}'::jsonb, null)$q$,
  array['22023'], 'valor negativo é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb) || '{"parcelas": "nenhuma"}'::jsonb, null)$q$,
  array['22023'], 'parcelas que não são lista são recusadas');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null,
       (select jsonb_agg(public.tmp_parcela('Parcela ' || g, 100, 'data', public.tmp_hoje() + 10)) from generate_series(1, 61) g)), null)$q$,
  array['22023'], 'mais de 60 parcelas é recusado');
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940111C', null,
       (select jsonb_agg(public.tmp_parcela('Parcela ' || g, 100, 'data', public.tmp_hoje() + 10)) from generate_series(1, 60) g)), null)$q$,
  '60 parcelas ainda cabem');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null,
       jsonb_build_array(public.tmp_parcela('Data com dias', 100, 'data', public.tmp_hoje() + 10, null, null, null, 5))), null)$q$,
  array['22023'], 'parcela de data fixa com dias é recusada');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null,
       jsonb_build_array(public.tmp_parcela('Evento com data', 100, 'evento', public.tmp_hoje() + 10, 'entrega'))), null)$q$,
  array['22023'], 'parcela por evento com vencimento é recusada');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null,
       jsonb_build_array(public.tmp_parcela('Protocolo sem projeto', 100, 'evento', null, 'protocolo'))), null)$q$,
  array['22023'], 'protocolo sem projeto é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null,
       jsonb_build_array(public.tmp_parcela('Outro sem descrição', 100, 'evento', null, 'outro'))), null)$q$,
  array['22023'], 'evento outro sem descrição é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null,
       jsonb_build_array(public.tmp_parcela('Dias demais', 100, 'evento', null, 'entrega', null, null, 3651))), null)$q$,
  array['22023'], 'mais de 3650 dias é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb, jsonb_build_array(public.tmp_p('04'))), null)$q$,
  array['P0001'], 'projeto de outro empreendimento no contrato é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb, '[]'::jsonb, public.tmp_doc(2)), null)$q$,
  array['23514'], 'documento de orçamento no contrato é recusado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940110C', null, '[]'::jsonb, '[]'::jsonb, public.tmp_doc(4)), null)$q$,
  array['23514'], 'documento de outro empreendimento no contrato é recusado');
select public.tmp_exige_conta(
  $q$select count(*) from public.itens_financeiros where codigo = '940110C'$q$, 0, 'nenhuma tentativa recusada deixou contrato gravado');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(public.tmp_item('940101C'), public.tmp_u('e002'), public.tmp_dados('940101C', null, '[]'::jsonb), public.tmp_atual('940101C'))$q$,
  array['P0001'], 'contrato de um empreendimento não é editado pelo outro');
select public.tmp_exige_erro(
  $q$select public.salvar_contrato_portal(public.tmp_u('1f01'), public.tmp_u('e002'), public.tmp_dados('940112C', null, '[]'::jsonb), null)$q$,
  array['P0001'], 'item de fornecedor não é salvo como contrato');

-- Excluir um contrato com assinatura e parcelas por evento (a cascata passa pelo set null do evento).
select public.tmp_exige_ok(
  $q$select public.salvar_contrato_portal(null, public.tmp_u('e001'), public.tmp_dados('940106C', public.tmp_hoje() - 1,
       jsonb_build_array(public.tmp_parcela('Na assinatura', 100, 'evento', null, 'assinatura', null, null, 0))), null)$q$,
  'contrato com assinatura e parcela por evento');
select public.tmp_exige_ok(
  $q$select public.excluir_item_financeiro_portal(public.tmp_item('940106C'))$q$,
  'excluir contrato com eventos e parcela por evento');
select public.tmp_como('postgres');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo = 'assinatura' and ocorrido_em = public.tmp_hoje() - 1$q$,
  0, 'excluir o contrato apaga os eventos dele');

-- ---------------------------------------------------------------------------
-- 9. A cobrar
-- ---------------------------------------------------------------------------

select public.tmp_como('d3');
select public.tmp_exige_texto(
  $q$select string_agg(numero::text, ',') from (select numero from public.listar_a_cobrar(15) where codigo = '940104C') x$q$,
  '1,6,5,2', 'com 15 dias: vencida, de hoje, parcial e a vencer em 10 (paga, a vencer em 20 e aguardando ficam fora), por vencimento');
select public.tmp_exige_texto(
  $q$select string_agg(numero::text, ',') from (select numero from public.listar_a_cobrar(30) where codigo = '940104C') x$q$,
  '1,6,5,2,3', 'com 30 dias entra a parcela de 20 dias');
select public.tmp_exige_texto(
  $q$select string_agg(numero::text, ',') from (select numero from public.listar_a_cobrar(0) where codigo = '940104C') x$q$,
  '1,6', 'com 0 dia: a vencida e a que vence hoje');
select public.tmp_exige_verdade(
  $q$select vencida and saldo_centavos = '100000' and total_parcelas = 7 and versao = 2 and descricao = 'Contrato Cobrança'
       and empreendimento_nome = 'Empreendimento Financeiro Dois' and empreendimento_id = public.tmp_u('e002') and item_id = public.tmp_u('1c04')
       and nome = 'Vencida' and vencimento = public.tmp_hoje() - 5
       from public.listar_a_cobrar(15) where codigo = '940104C' and numero = 1$q$,
  'a linha da parcela vencida traz contrato, saldo, total de parcelas e nome do empreendimento');
select public.tmp_exige_verdade(
  $q$select not vencida from public.listar_a_cobrar(15) where codigo = '940104C' and numero = 6$q$,
  'a parcela que vence hoje não é vencida');
select public.tmp_exige_verdade(
  $q$select saldo_centavos = '350000' from public.listar_a_cobrar(15) where codigo = '940104C' and numero = 5$q$,
  'parcela parcial entra pelo saldo');
select public.tmp_exige_conta(
  $q$select count(*) from public.listar_a_cobrar(90) where item_id = public.tmp_u('1f01')$q$, 0, 'item de fornecedor fica fora do "A cobrar"');
select public.tmp_exige_conta(
  $q$select count(*) from public.listar_a_cobrar(90) where nome = 'Na assinatura' and codigo = '940101C'$q$, 0, 'parcela paga do contrato 940101C não aparece');
select public.tmp_exige_erro($q$select * from public.listar_a_cobrar(-1)$q$, array['22023'], 'prazo negativo é recusado');
select public.tmp_exige_erro($q$select * from public.listar_a_cobrar(91)$q$, array['22023'], 'prazo acima de 90 dias é recusado');
select public.tmp_exige_erro($q$select * from public.listar_a_cobrar(null)$q$, array['22023'], 'prazo nulo é recusado');
select public.tmp_como('d1');
select public.tmp_exige_maior($q$select count(*) from public.listar_a_cobrar()$q$, 1, 'o prazo padrão é de 15 dias e o admin enxerga as parcelas de todos os empreendimentos');
select public.tmp_como('postgres');

-- ---------------------------------------------------------------------------
-- 10. Eventos retroativos (o que já aconteceu quando a migration roda)
-- ---------------------------------------------------------------------------

-- Cada projeto abaixo nasce já na etapa indicada, sem histórico: é o estado de antes da migration.
select public.tmp_novo_projeto(public.tmp_u('e002'), 'a1', 'Retroativo em análise', 'saa', 3);
select public.tmp_novo_projeto(public.tmp_u('e002'), 'a2', 'Retroativo aprovado', 'saa', 4);
select public.tmp_novo_projeto(public.tmp_u('e002'), 'a3', 'Retroativo sem data', 'saa', 3);
select public.tmp_novo_projeto(public.tmp_u('e002'), 'a4', 'Retroativo só com sinal', 'saa', 2);
select public.tmp_novo_projeto(public.tmp_u('e002'), 'a5', 'Retroativo sinal ignorado', 'saa', 1);
select public.tmp_novo_projeto(public.tmp_u('e002'), 'a6', 'Retroativo aprovado por sinal', 'saa', 4);
select public.tmp_concluida('a1', 2, public.tmp_hoje() - 40);
select public.tmp_concluida('a2', 2, public.tmp_hoje() - 30);
select public.tmp_concluida('a2', 4, public.tmp_hoje() - 3);

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho)
select public.tmp_doc(n), public.tmp_u('e002'), 'Arquivo ' || n, public.tmp_u('e002')::text || '/' || public.tmp_doc(n)::text || '.pdf', 'application/pdf', 100
from generate_series(11, 14) as n;
insert into public.etapa_sinais (empreendimento_id, projeto_id, documento_id, tipo, data_arquivo, aplicado_em, ignorado_em)
values
  (public.tmp_u('e002'), public.tmp_p('a4'), public.tmp_doc(11), 'protocolo', public.tmp_meiodia(public.tmp_hoje() - 50), now(), null),
  (public.tmp_u('e002'), public.tmp_p('a5'), public.tmp_doc(12), 'protocolo', public.tmp_meiodia(public.tmp_hoje() - 60), now(), now()),
  (public.tmp_u('e002'), public.tmp_p('a5'), public.tmp_doc(13), 'protocolo', public.tmp_meiodia(public.tmp_hoje() - 61), null, null),
  (public.tmp_u('e002'), public.tmp_p('a6'), public.tmp_doc(14), 'aprovado', public.tmp_meiodia(public.tmp_hoje() - 7), now(), null);

select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id in (select id from public.projetos where nome like 'Retroativo%')$q$, 0,
  'projeto que nasce na etapa não gera evento (só o histórico gera)');
select public.financeiro_eventos_retroativos();

select public.tmp_exige_verdade(
  $q$select (select ocorrido_em from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('a1') and desfeito_em is null) = public.tmp_hoje() - 40
       and (select origem from public.financeiro_eventos where tipo = 'entrega' and projeto_id = public.tmp_p('a1') and desfeito_em is null) = 'protocolo'
       and (select ocorrido_em from public.financeiro_eventos where tipo = 'entrega' and projeto_id = public.tmp_p('a1') and desfeito_em is null) = public.tmp_hoje() - 40
       and (select criado_por from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('a1')) is null$q$,
  'retroativo: projeto em análise ganha protocolo e entrega com a conclusão da etapa anterior, sem autor');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where tipo = 'aprovacao' and projeto_id = public.tmp_p('a1')$q$, 0, 'retroativo: em análise não ganha aprovação');
select public.tmp_exige_verdade(
  $q$select (select ocorrido_em from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('a2')) = public.tmp_hoje() - 30
       and (select ocorrido_em from public.financeiro_eventos where tipo = 'aprovacao' and projeto_id = public.tmp_p('a2')) = public.tmp_hoje() - 3$q$,
  'retroativo: projeto aprovado ganha protocolo e aprovação com as conclusões das etapas');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('a3')$q$, 0, 'retroativo: sem nenhuma data, não cria');
select public.tmp_exige_verdade(
  $q$select ocorrido_em = public.tmp_hoje() - 50 from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('a4')$q$,
  'retroativo: sinal de protocolo aplicado dá o protocolo, com o dia do arquivo');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('a5')$q$, 0, 'retroativo: sinal ignorado ou não aplicado não conta');
select public.tmp_exige_verdade(
  $q$select (select ocorrido_em from public.financeiro_eventos where tipo = 'aprovacao' and projeto_id = public.tmp_p('a6')) = public.tmp_hoje() - 7
       and not exists (select 1 from public.financeiro_eventos where tipo = 'protocolo' and projeto_id = public.tmp_p('a6'))$q$,
  'retroativo: aprovação sem data de conclusão usa o sinal; sem data do protocolo, não cria o protocolo');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('a1') and desfeito_em is null$q$, 2, 'retroativo: dois eventos ativos em a1');
select public.financeiro_eventos_retroativos();
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id in (public.tmp_p('a1'), public.tmp_p('a2'), public.tmp_p('a4'), public.tmp_p('a6'))$q$,
  2 + 3 + 2 + 1, 'retroativo: repetir não duplica os eventos');

-- ---------------------------------------------------------------------------
-- 11. Correções da revisão (Codex, 15/11): escrita direta do contrato, parcela trocando de item, exceção da cascata e
--     entrega derivada do protocolo marcado pelo botão
-- ---------------------------------------------------------------------------

select public.tmp_como('d2');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set assinado_em = public.tmp_hoje() - 1 where id = public.tmp_item('940101C')$q$,
  array['P0001'], 'update direto da assinatura do contrato é recusado');
select public.tmp_exige_erro(
  $q$update public.itens_financeiros set codigo = '949999C' where id = public.tmp_item('940101C')$q$,
  array['P0001'], 'update direto do código do contrato é recusado');
select public.tmp_exige_erro(
  $q$insert into public.itens_financeiros (empreendimento_id, descricao, valor_contratado_centavos, codigo) values (public.tmp_u('e001'), 'Contrato por fora', 100, '949998C')$q$,
  array['P0001'], 'insert direto de contrato com código é recusado');
select public.tmp_exige_ok(
  $q$update public.itens_financeiros set descricao = descricao where id = public.tmp_item('940101C')$q$,
  'update direto que não mexe nos campos do contrato continua valendo');
select public.tmp_exige_erro(
  $q$update public.parcelas set item_id = public.tmp_item('940102C') where id = public.tmp_pid('940101C', 3)$q$,
  array['P0001'], 'parcela por evento não troca de contrato por update direto');
select public.tmp_exige_erro(
  $q$update public.parcelas set evento_id = null
       where id = (select pa.id from public.parcelas pa where pa.evento_id is not null order by pa.id limit 1)$q$,
  array['P0001'], 'zerar só o evento_id por update direto é recusado (a exceção vale só para a cascata)');

select public.tmp_como('postgres');
select public.tmp_exige_maior(
  $q$select count(*) from public.parcelas where evento_id is not null$q$, 1, 'há parcela com evento para o teste acima');
select public.tmp_novo_projeto(public.tmp_u('e001'), 'b1', 'Projeto Protocolo Manual', 'saa');
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'protocolo', public.tmp_hoje() - 20, public.tmp_p('b1'))$q$,
  'marcar protocolo pelo botão');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select e.origem = 'protocolo' and e.ocorrido_em = public.tmp_hoje() - 20 and e.origem_evento_id = (
           select p.id from public.financeiro_eventos p where p.tipo = 'protocolo' and p.projeto_id = public.tmp_p('b1') and p.desfeito_em is null)
       from public.financeiro_eventos e where e.tipo = 'entrega' and e.projeto_id = public.tmp_p('b1') and e.desfeito_em is null$q$,
  'protocolo pelo botão cria a entrega do projeto ligada a ele');
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'protocolo', public.tmp_hoje() - 15, public.tmp_p('b1'), null, null, true)$q$,
  'substituir o protocolo pelo botão');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select count(*) = 1 and min(e.ocorrido_em) = public.tmp_hoje() - 15
       from public.financeiro_eventos e where e.tipo = 'entrega' and e.projeto_id = public.tmp_p('b1') and e.desfeito_em is null$q$,
  'substituir o protocolo troca a entrega derivada');
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.desfazer_evento_financeiro((select e.id from public.financeiro_eventos e where e.tipo = 'protocolo' and e.projeto_id = public.tmp_p('b1') and e.desfeito_em is null))$q$,
  'desfazer o protocolo pelo botão');
select public.tmp_como('postgres');
select public.tmp_exige_conta(
  $q$select count(*) from public.financeiro_eventos where projeto_id = public.tmp_p('b1') and desfeito_em is null$q$,
  0, 'desfazer o protocolo desfaz a entrega derivada');
select public.tmp_como('d2');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'entrega', public.tmp_hoje() - 30, public.tmp_p('b1'))$q$,
  'marcar a entrega antes do protocolo');
select public.tmp_exige_ok(
  $q$select public.marcar_evento_financeiro(public.tmp_u('e001'), 'protocolo', public.tmp_hoje() - 10, public.tmp_p('b1'))$q$,
  'marcar o protocolo depois da entrega');
select public.tmp_como('postgres');
select public.tmp_exige_verdade(
  $q$select count(*) = 1 and min(e.ocorrido_em) = public.tmp_hoje() - 30 and bool_and(e.origem = 'botao')
       from public.financeiro_eventos e where e.tipo = 'entrega' and e.projeto_id = public.tmp_p('b1') and e.desfeito_em is null$q$,
  'entrega marcada antes continua valendo quando o protocolo chega depois');

select 'OK: financeiro fase 1 passou nos testes' as resultado;

rollback;
