-- Testes do modelo de pastas: RLS de catalogo_pastas, empreendimentos.ler_complementares e
-- montar_empreendimento_de_pastas (docs/MODELO-PASTAS-CONTRATO.md; migration 20261111100000_modelo_pastas.sql).
-- Como rodar (somente em banco de TESTE ou com o ROLLBACK do fim):
--   npx.cmd supabase db query --linked -f supabase/tests/modelo_pastas.sql
-- Rode com o usuário postgres, depois de TODAS as migrations. Tudo acontece numa transação que termina em ROLLBACK.
-- Usa o catálogo semeado pela migration (saa, per, os, simos, contratos, doacao) e os modelos reais. O conector ativo
-- (no máximo um) ganha, só dentro da transação, a árvore de um código de pasta de teste (919191).
-- Fixture: ids 92000000-...

begin;

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
  if v_conta <> p_esperado then
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
  if v_conta < p_minimo then
    raise exception 'FALHA: % (contou %, mínimo %)', p_msg, v_conta, p_minimo;
  end if;
end;
$$;

grant execute on function public.tmp_exige_ok(text, text) to authenticated, anon;
grant execute on function public.tmp_exige_erro(text, text[], text) to authenticated, anon;
grant execute on function public.tmp_exige_negado(text, text) to authenticated, anon;
grant execute on function public.tmp_exige_conta(text, bigint, text) to authenticated, anon;
grant execute on function public.tmp_exige_maior(text, bigint, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.conectores where revogado_em is null) then
    raise exception 'FALHA: o teste precisa de um conector ativo (só a árvore dele é alterada, dentro da transação)';
  end if;
  if (select count(*) from public.catalogo_pastas where chave in ('saa', 'per', 'os', 'simos', 'contratos', 'doacao') and ativo) <> 6 then
    raise exception 'FALHA: catálogo semeado incompleto (saa, per, os, simos, contratos, doacao ativos)';
  end if;
end;
$$;

insert into auth.users (id, aud, role, email)
values
  ('92000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'admin-pastas@example.com'),
  ('92000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'equipe-completa-pastas@example.com'),
  ('92000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'equipe-so-editar-pastas@example.com'),
  ('92000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', 'equipe-so-regras-pastas@example.com'),
  ('92000000-0000-0000-0000-0000000000d5', 'authenticated', 'authenticated', 'cliente-pastas@example.com'),
  ('92000000-0000-0000-0000-0000000000d6', 'authenticated', 'authenticated', 'equipe-sem-pastas@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('92000000-0000-0000-0000-0000000000d1', 'admin', 'Admin Pastas', true, false),
  ('92000000-0000-0000-0000-0000000000d2', 'equipe', 'Equipe Completa Pastas', true, false),
  ('92000000-0000-0000-0000-0000000000d3', 'equipe', 'Equipe Só Editar Pastas', true, false),
  ('92000000-0000-0000-0000-0000000000d4', 'equipe', 'Equipe Só Regras Pastas', true, false),
  ('92000000-0000-0000-0000-0000000000d5', 'cliente', 'Cliente Pastas', true, false),
  ('92000000-0000-0000-0000-0000000000d6', 'equipe', 'Equipe Sem Pastas', true, false);

insert into public.equipe_permissoes (profile_id, permissao)
values
  ('92000000-0000-0000-0000-0000000000d2', 'empreendimentos.ver'),
  ('92000000-0000-0000-0000-0000000000d3', 'empreendimentos.ver'),
  ('92000000-0000-0000-0000-0000000000d4', 'empreendimentos.ver');
insert into public.equipe_permissoes (profile_id, permissao)
values
  ('92000000-0000-0000-0000-0000000000d2', 'empreendimentos.editar'),
  ('92000000-0000-0000-0000-0000000000d2', 'servidor.regras'),
  ('92000000-0000-0000-0000-0000000000d3', 'empreendimentos.editar'),
  ('92000000-0000-0000-0000-0000000000d4', 'servidor.regras');

insert into public.empreendimentos (id, nome, cidade, codigo_pasta)
values ('92000000-0000-0000-0000-00000000e001', 'Empreendimento Pastas Teste', 'Cidade', '919191');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('92000000-0000-0000-0000-00000000e001', '92000000-0000-0000-0000-0000000000d5');

update public.conectores
set arvore = coalesce(arvore, '{}'::jsonb) || jsonb_build_object('919191', jsonb_build_array(
  '02 - FINANCEIRO',
  '02 - FINANCEIRO/01 - PROPOSTA E CONTRATO',
  '02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS',
  '03 - PRODUTOS',
  '03 - PRODUTOS/02 - P. SAA',
  '03 - PRODUTOS/02 - P. SAA/02 - LAN',
  '03 - PRODUTOS/02 - P. SAA/02 - LAN/01 - APROVADO NO INTERLIGA',
  '03 - PRODUTOS/05 - PER - SAA',
  '03 - PRODUTOS/05 - PER - SAA/01 - APROVADO',
  '03 - PRODUTOS/14 - ORDEM DE SERVIÇO',
  '03 - PRODUTOS/14 - ORDEM DE SERVIÇO/03 - ORDEM DE SERVIÇO - APROVADA',
  '03 - PRODUTOS/15 - DOAÇÃO - BENS',
  '03 - PRODUTOS/15 - DOAÇÃO - BENS/01 - BENS IMÓVEIS',
  '03 - PRODUTOS/15 - DOAÇÃO - BENS/01 - BENS IMÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO',
  '03 - PRODUTOS/19 - SIMOS E LAUDOS'
))
where revogado_em is null;

-- Itens usados abaixo.
create temporary table tmp_itens (nome text primary key, itens jsonb not null) on commit drop;
grant select on tmp_itens to authenticated, anon;
insert into tmp_itens values
  ('base', '[
     {"chave": "saa", "caminhos": ["03 - PRODUTOS/02 - P. SAA/02 - LAN/01 - APROVADO NO INTERLIGA"], "nome_projeto": "Sistema de Abastecimento de Água - SAA"},
     {"chave": "os", "caminhos": ["03 - PRODUTOS/14 - ORDEM DE SERVIÇO/03 - ORDEM DE SERVIÇO - APROVADA"], "nome_projeto": "Ordem de Serviço"},
     {"chave": "simos", "caminhos": ["03 - PRODUTOS/19 - SIMOS E LAUDOS"]},
     {"chave": "contratos", "caminhos": ["02 - FINANCEIRO/01 - PROPOSTA E CONTRATO/01 - ASSINADOS"]}
   ]'::jsonb),
  ('per', '[{"chave": "per", "caminhos": ["03 - PRODUTOS/05 - PER - SAA/01 - APROVADO"], "projeto_pai_chave": "saa", "nome_projeto": "Projeto Elétrico Referência - PER"}]'::jsonb),
  ('fora', '[{"chave": "saa", "caminhos": ["03 - PRODUTOS/99 - INVENTADA"], "nome_projeto": "Sistema de Abastecimento de Água - SAA"}]'::jsonb),
  ('meio', '[
     {"chave": "doacao", "caminhos": ["03 - PRODUTOS/15 - DOAÇÃO - BENS/01 - BENS IMÓVEIS/03 - CERTIDÃO DE DESONERAÇÃO"], "nome_projeto": "Doação de Bens"},
     {"chave": "contratos", "caminhos": ["02 - FINANCEIRO/NAO EXISTE"]}
   ]'::jsonb);

create function public.tmp_montar(p_nome text)
returns jsonb language sql as $$
  select public.montar_empreendimento_de_pastas('92000000-0000-0000-0000-00000000e001', (select itens from tmp_itens where nome = p_nome));
$$;
grant execute on function public.tmp_montar(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. Catálogo: quem lê e quem altera
-- ---------------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select public.tmp_exige_maior('select count(*) from public.catalogo_pastas', 6, 'equipe com servidor.regras lê o catálogo');
select public.tmp_exige_negado($q$update public.catalogo_pastas set ordem = ordem where chave = 'saa'$q$, 'equipe não altera o catálogo');
select public.tmp_exige_negado($q$delete from public.catalogo_pastas where chave = 'saa'$q$, 'equipe não apaga do catálogo');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d6","role":"authenticated"}', true);
select public.tmp_exige_conta('select count(*) from public.catalogo_pastas', 0, 'equipe sem permissão não lê o catálogo');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d5","role":"authenticated"}', true);
select public.tmp_exige_conta('select count(*) from public.catalogo_pastas', 0, 'cliente não lê o catálogo');
select public.tmp_exige_negado($q$update public.empreendimentos set ler_complementares = true where id = '92000000-0000-0000-0000-00000000e001'$q$, 'cliente não liga os complementares');
select public.tmp_exige_erro($q$select public.tmp_montar('base')$q$, array['42501'], 'cliente não monta');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select public.tmp_exige_ok($q$update public.catalogo_pastas set ordem = ordem where chave = 'saa'$q$, 'admin altera o catálogo');
select public.tmp_exige_erro($q$update public.catalogo_pastas set termos = array['saa minúsculo'] where chave = 'saa'$q$, array['23514'], 'termo fora do formato é recusado');
select public.tmp_exige_ok($q$update public.catalogo_pastas set termos = termos where chave = 'estrutural_reservatorio'$q$, 'termo com alternativas (RESERVATORIO|REL) é aceito');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.tmp_exige_erro('select count(*) from public.catalogo_pastas', array['42501'], 'anon não lê o catálogo');
select public.tmp_exige_erro($q$select public.tmp_montar('base')$q$, array['42501'], 'anon não monta');

-- ---------------------------------------------------------------------------
-- 2. Montagem: permissões e recusas
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
select public.tmp_exige_erro($q$select public.tmp_montar('base')$q$, array['42501'], 'só empreendimentos.editar não monta');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select public.tmp_exige_erro($q$select public.tmp_montar('base')$q$, array['42501'], 'só servidor.regras não monta');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select public.tmp_exige_erro($q$select public.tmp_montar('fora')$q$, array['P0001'], 'caminho fora da árvore é recusado');
select public.tmp_exige_erro($q$select public.tmp_montar('per')$q$, array['P0001'], 'complementar com ler_complementares desligado é recusado');

-- ---------------------------------------------------------------------------
-- 3. Montagem base: cria, não duplica
-- ---------------------------------------------------------------------------

select public.tmp_exige_ok($q$select public.tmp_montar('base')$q$, 'montagem base com as duas permissões');

reset role;
select public.tmp_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '92000000-0000-0000-0000-00000000e001'$q$, 2, 'base cria SAA e OS');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = '92000000-0000-0000-0000-00000000e001'$q$, 4, 'base cria 4 regras');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = '92000000-0000-0000-0000-00000000e001' and (liberar_automatico or not ativa)$q$, 0, 'regras nascem ativas e ocultas');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras r join public.projetos p on p.id = r.projeto_id
  where r.empreendimento_id = '92000000-0000-0000-0000-00000000e001' and r.tipo = 'equipamentos' and p.nome = 'Ordem de Serviço'$q$, 1, 'SIMOS vira regra de equipamentos na OS');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = '92000000-0000-0000-0000-00000000e001' and grupo = 'contratos' and projeto_id is null$q$, 1, 'contratos vira regra de grupo');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras r join public.projeto_categorias_documento c on c.id = r.categoria_id
  where r.empreendimento_id = '92000000-0000-0000-0000-00000000e001' and r.tipo = 'comum' and r.projeto_id is not null$q$, 2, 'regras de projeto apontam para uma categoria');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select public.tmp_exige_ok($q$select public.tmp_montar('base')$q$, 'segunda montagem roda');
reset role;
select public.tmp_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '92000000-0000-0000-0000-00000000e001'$q$, 2, 'segunda montagem não duplica projetos');
select public.tmp_exige_conta($q$select count(*) from public.pasta_regras where empreendimento_id = '92000000-0000-0000-0000-00000000e001'$q$, 4, 'segunda montagem não duplica regras');

-- ---------------------------------------------------------------------------
-- 4. Complementares
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select public.tmp_exige_ok($q$update public.empreendimentos set ler_complementares = true where id = '92000000-0000-0000-0000-00000000e001'$q$, 'equipe com empreendimentos.editar liga os complementares');
select public.tmp_exige_ok($q$select public.tmp_montar('per')$q$, 'PER entra depois de ligar os complementares');
reset role;
select public.tmp_exige_conta($q$select count(*) from public.projetos f join public.projetos p on p.id = f.projeto_pai_id
  where f.empreendimento_id = '92000000-0000-0000-0000-00000000e001' and f.nome = 'Projeto Elétrico Referência - PER'
    and p.nome = 'Sistema de Abastecimento de Água - SAA'$q$, 1, 'PER depende do SAA');

-- ---------------------------------------------------------------------------
-- 5. Tudo ou nada
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select public.tmp_exige_erro($q$select public.tmp_montar('meio')$q$, array['P0001'], 'erro no segundo item recusa a montagem');
reset role;
select public.tmp_exige_conta($q$select count(*) from public.projetos where empreendimento_id = '92000000-0000-0000-0000-00000000e001' and nome = 'Doação de Bens'$q$, 0, 'erro no meio desfaz o primeiro item');

select 'OK' as resultado;

rollback;
