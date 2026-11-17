-- Testes da Etapa 5, frente A (obras e empreiteiro): RLS, vínculos, RPCs e auditoria.
-- Como rodar (somente em banco de TESTE, nunca em produção):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa5_obras_rls.sql
-- Rode com o usuário postgres, depois de TODAS as migrations, inclusive
-- 20261031100000_etapa5_obras_fornecedores.sql. Tudo acontece dentro de uma transação que
-- termina em ROLLBACK. Se alguma verificação falhar, o script para com "FALHA: ..."; se
-- chegar ao fim, o último SELECT imprime "OK".
-- Contas pendentes (precisa_trocar_senha = true) e inativas ficam sem papel no banco
-- (papel_atual() exige ativo e senha já trocada), além do guard da aplicação.
-- Ordem: estrutura, anon, clientes, empreiteiros, equipe (revisão), admin (auditoria),
-- cliente depois das revisões e, por último, o vínculo removido.

begin;

create function public.t5a_exige_negado(p_sql text, p_msg text)
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

create function public.t5a_exige_erro(p_sql text, p_estados text[], p_msg text)
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

create function public.t5a_exige_linhas(p_sql text, p_esperado bigint, p_msg text)
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

create function public.t5a_exige_conta(p_sql text, p_esperado bigint, p_msg text)
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

-- Quem não tem papel não lê nada: ou o grant falta (42501) ou o RLS devolve zero linhas.
create function public.t5a_exige_nada(p_quem text)
returns void
language plpgsql
as $$
declare
  v_tabela text;
  v_conta bigint;
begin
  foreach v_tabela in array array['obras', 'obra_empreiteiros', 'relatos_obra', 'relato_fotos'] loop
    begin
      execute format('select count(*) from public.%I', v_tabela) into v_conta;
    exception when insufficient_privilege then
      v_conta := 0;
    end;
    if v_conta <> 0 then
      raise exception 'FALHA: % não deveria ver linhas de %, viu %', p_quem, v_tabela, v_conta;
    end if;
  end loop;
end;
$$;

-- p_n fotos JPEG com id e caminho coerentes com a obra e o relato.
create function public.t5a_fotos(p_obra uuid, p_relato uuid, p_n int, p_prefixo text)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', md5(p_prefixo || g)::uuid,
    'path', 'relatos/' || p_obra || '/' || p_relato || '/' || md5(p_prefixo || g)::uuid || '.jpg',
    'mime', 'image/jpeg',
    'tamanho', 1000
  )), '[]'::jsonb)
  from generate_series(1, p_n) as g
$$;

grant execute on function public.t5a_exige_negado(text, text) to anon, authenticated;
grant execute on function public.t5a_exige_erro(text, text[], text) to anon, authenticated;
grant execute on function public.t5a_exige_linhas(text, bigint, text) to anon, authenticated;
grant execute on function public.t5a_exige_conta(text, bigint, text) to anon, authenticated;
grant execute on function public.t5a_exige_nada(text) to anon, authenticated;
grant execute on function public.t5a_fotos(uuid, uuid, int, text) to anon, authenticated;

-- Fixture: cliente A e B; empreiteiro A (obra A1), B (obra B1), não atribuído, inativo e
-- pendente (os dois últimos vinculados à obra A1); fornecedor; equipe; admin.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000005c1', 'authenticated', 'authenticated', 'cliente-a-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005c2', 'authenticated', 'authenticated', 'cliente-b-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005e1', 'authenticated', 'authenticated', 'empreiteiro-a-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005e2', 'authenticated', 'authenticated', 'empreiteiro-b-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005e3', 'authenticated', 'authenticated', 'empreiteiro-livre-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005e4', 'authenticated', 'authenticated', 'empreiteiro-inativo-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005e5', 'authenticated', 'authenticated', 'empreiteiro-pendente-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005f1', 'authenticated', 'authenticated', 'fornecedor-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005b1', 'authenticated', 'authenticated', 'equipe-etapa5a@example.com'),
  ('00000000-0000-0000-0000-0000000005a1', 'authenticated', 'authenticated', 'admin-etapa5a@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000005c1', 'cliente', 'Cliente A Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005c2', 'cliente', 'Cliente B Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005e1', 'empreiteiro', 'Empreiteiro A Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005e2', 'empreiteiro', 'Empreiteiro B Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005e3', 'empreiteiro', 'Empreiteiro Livre Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005e4', 'empreiteiro', 'Empreiteiro Inativo Etapa5 Teste', false, false),
  ('00000000-0000-0000-0000-0000000005e5', 'empreiteiro', 'Empreiteiro Pendente Etapa5 Teste', true, true),
  ('00000000-0000-0000-0000-0000000005f1', 'fornecedor', 'Fornecedor Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005b1', 'equipe', 'Equipe Etapa5 Teste', true, false),
  ('00000000-0000-0000-0000-0000000005a1', 'admin', 'Admin Etapa5 Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000005b1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome, cidade)
values
  ('50000000-0000-0000-0000-00000000a001', 'Empreendimento A Etapa5 Teste', 'Cidade A'),
  ('50000000-0000-0000-0000-00000000a002', 'Empreendimento B Etapa5 Teste', 'Cidade B');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values
  ('50000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000005c1'),
  ('50000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-0000000005c2');

insert into public.obras (id, empreendimento_id, nome, percentual, situacao)
values
  ('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000a001', 'Obra A1 Etapa5 Teste', 10, 'em_andamento'),
  ('50000000-0000-0000-0000-00000000b0a2', '50000000-0000-0000-0000-00000000a001', 'Obra A2 Etapa5 Teste', 0, 'planejada'),
  ('50000000-0000-0000-0000-00000000b0b1', '50000000-0000-0000-0000-00000000a002', 'Obra B1 Etapa5 Teste', 20, 'em_andamento');

insert into public.obra_empreiteiros (obra_id, profile_id)
values
  ('50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1'),
  ('50000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000005e2'),
  ('50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e4'),
  ('50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e5');

insert into public.relatos_obra (id, obra_id, autor_id, texto, status, motivo_devolucao, revisado_por, revisado_em)
values
  ('50000000-0000-0000-0000-00000000c0a1', '50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1',
   'Relato A1 aprovado', 'aprovado', null, '00000000-0000-0000-0000-0000000005b1', now()),
  ('50000000-0000-0000-0000-00000000c0a2', '50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1',
   'Relato A1 pendente', 'pendente', null, null, null),
  ('50000000-0000-0000-0000-00000000c0a3', '50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1',
   'Relato A1 devolvido', 'devolvido', 'Faltou foto', '00000000-0000-0000-0000-0000000005b1', now()),
  ('50000000-0000-0000-0000-00000000c0b1', '50000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-0000000005e2',
   'Relato B1 aprovado', 'aprovado', null, '00000000-0000-0000-0000-0000000005b1', now());

insert into public.relato_fotos (relato_id, storage_path, mime, tamanho)
values
  ('50000000-0000-0000-0000-00000000c0a1', 'relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000c0a1/etapa5a-teste-f1.jpg', 'image/jpeg', 1000),
  ('50000000-0000-0000-0000-00000000c0a2', 'relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000c0a2/etapa5a-teste-f1.jpg', 'image/jpeg', 1000),
  ('50000000-0000-0000-0000-00000000c0b1', 'relatos/50000000-0000-0000-0000-00000000b0b1/50000000-0000-0000-0000-00000000c0b1/etapa5a-teste-f1.jpg', 'image/jpeg', 1000);

-- Objetos que enviar_relato_obra exige no Storage (tamanho declarado = 1000), exceto 'tam' (999).
insert into storage.objects (bucket_id, name, metadata)
select 'obras', f.value->>'path', jsonb_build_object('size', (f.value->>'tamanho')::bigint)
from jsonb_array_elements(
  public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 2, 'r1')
  || public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e2', 10, 'r2')
) as f;
insert into storage.objects (bucket_id, name, metadata)
select 'obras', f.value->>'path', jsonb_build_object('size', 999)
from jsonb_array_elements(
  public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'tam')
) as f;

-- ---------------------------------------------------------------------------
-- Estrutura (como postgres): triggers, grants das RPCs, Storage e imutabilidade.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.relatos_obra'::regclass and tgname = 'relatos_obra_validar_revisao' and not tgisinternal) then
    raise exception 'FALHA: falta a trigger de revisão do relato';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.obra_empreiteiros'::regclass and tgname = 'obra_empreiteiros_validar_vinculos_acesso' and not tgisinternal) then
    raise exception 'FALHA: falta a trigger de papel no vínculo de empreiteiro';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.relato_fotos'::regclass and tgname = 'relato_fotos_registrar_auditoria' and not tgisinternal) then
    raise exception 'FALHA: falta a auditoria das fotos do relato';
  end if;

  if has_function_privilege('anon', 'public.enviar_relato_obra(uuid, uuid, text, int, public.obra_situacao, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.revisar_relato_obra(uuid, text, text, int, public.obra_situacao)', 'execute') then
    raise exception 'FALHA: anon não pode executar as RPCs de relato';
  end if;
  if not has_function_privilege('authenticated', 'public.enviar_relato_obra(uuid, uuid, text, int, public.obra_situacao, jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.revisar_relato_obra(uuid, text, text, int, public.obra_situacao)', 'execute') then
    raise exception 'FALHA: authenticated deve executar as RPCs de relato (a autorização é interna)';
  end if;
  if has_function_privilege('authenticated', 'public.validar_vinculos_acesso()', 'execute') then
    raise exception 'FALHA: função de trigger não pode ter EXECUTE direto';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') like '%obras%' or coalesce(with_check, '') like '%obras%')
  ) then
    raise exception 'FALHA: o bucket obras não pode ter política de escrita direta';
  end if;
end $$;

-- Vínculo de empreiteiro exige perfil empreiteiro e é imutável.
select public.t5a_exige_erro(
  $q$insert into public.obra_empreiteiros (obra_id, profile_id) values ('50000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000005c1')$q$,
  array['23514'], 'vínculo de obra com perfil cliente deveria falhar');
select public.t5a_exige_erro(
  $q$insert into public.obra_empreiteiros (obra_id, profile_id) values ('50000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000005f1')$q$,
  array['23514'], 'vínculo de obra com perfil fornecedor deveria falhar');
select public.t5a_exige_erro(
  $q$insert into public.obra_empreiteiros (obra_id, profile_id) values ('50000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000005b1')$q$,
  array['23514'], 'vínculo de obra com perfil equipe deveria falhar');
select public.t5a_exige_erro(
  $q$update public.obra_empreiteiros set profile_id = '00000000-0000-0000-0000-0000000005e3' where profile_id = '00000000-0000-0000-0000-0000000005e2'$q$,
  array['23514'], 'vínculo não pode ser transferido para outro empreiteiro');
select public.t5a_exige_erro(
  $q$update public.obra_empreiteiros set obra_id = '50000000-0000-0000-0000-00000000b0a2' where profile_id = '00000000-0000-0000-0000-0000000005e2'$q$,
  array['23514'], 'vínculo não pode ser movido para outra obra');

-- Conteúdo do relato é imutável; status só sai de pendente; devolvido exige motivo.
select public.t5a_exige_erro(
  $q$update public.relatos_obra set texto = 'Texto reescrito' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  array['23514'], 'texto do relato é imutável');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set percentual_informado = 99 where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  array['23514'], 'percentual informado é imutável');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set situacao_informada = 'concluida' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  array['23514'], 'situação informada é imutável');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set autor_id = '00000000-0000-0000-0000-0000000005e2' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  array['23514'], 'autor do relato é imutável');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set obra_id = '50000000-0000-0000-0000-00000000b0b1' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  array['23514'], 'obra do relato é imutável');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set status = 'devolvido', motivo_devolucao = '  ' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  array['23514'], 'devolver sem motivo deveria falhar');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set status = 'pendente' where id = '50000000-0000-0000-0000-00000000c0a1'$q$,
  array['55000'], 'relato aprovado não volta a pendente');
select public.t5a_exige_erro(
  $q$update public.relatos_obra set status = 'aprovado' where id = '50000000-0000-0000-0000-00000000c0a3'$q$,
  array['55000'], 'relato devolvido não pode ser aprovado depois');
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000c0a2' and texto = 'Relato A1 pendente' and status = 'pendente'$q$,
  1, 'tentativas inválidas deveriam preservar o relato');

-- ---------------------------------------------------------------------------
-- anon: nada lê, nada escreve, nenhuma RPC.
-- ---------------------------------------------------------------------------
set local role anon;
select public.t5a_exige_nada('anon');
select public.t5a_exige_negado(
  $q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1', 'Invasor')$q$,
  'anon não insere relato');
select public.t5a_exige_negado(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Invasor', null, null, '[]'::jsonb)$q$,
  'anon não envia relato');
select public.t5a_exige_negado(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, 100, 'concluida')$q$,
  'anon não revisa relato');
reset role;

-- ---------------------------------------------------------------------------
-- Cliente A: lê a obra do próprio empreendimento e só relato aprovado, sem escrever.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005c1","role":"authenticated"}';
select public.t5a_exige_conta('select count(*) from public.obras', 2, 'cliente A deveria ver as duas obras do empreendimento A');
select public.t5a_exige_conta($q$select count(*) from public.obras where id = '50000000-0000-0000-0000-00000000b0b1'$q$, 0, 'cliente A não vê obra do empreendimento B');
select public.t5a_exige_conta('select count(*) from public.relatos_obra', 1, 'cliente A só vê o relato aprovado');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where status <> 'aprovado'$q$, 0, 'cliente A não vê pendente nem devolvido');
select public.t5a_exige_conta('select count(*) from public.relato_fotos', 1, 'cliente A só vê foto de relato aprovado');
select public.t5a_exige_conta('select count(*) from public.obra_empreiteiros', 0, 'cliente não vê vínculos de empreiteiro');
select public.t5a_exige_negado(
  $q$insert into public.relatos_obra (obra_id, autor_id, texto) values ('50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005c1', 'Cliente escrevendo')$q$,
  'cliente não insere relato');
select public.t5a_exige_negado(
  $q$update public.obras set percentual = 99 where id = '50000000-0000-0000-0000-00000000b0a1'$q$,
  'cliente não altera obra');
select public.t5a_exige_negado(
  $q$update public.relatos_obra set status = 'aprovado' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  'cliente não revisa relato por UPDATE');
select public.t5a_exige_negado(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, 100, 'concluida')$q$,
  'cliente não revisa relato pela RPC');
select public.t5a_exige_negado(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Cliente enviando', null, null, '[]'::jsonb)$q$,
  'cliente não envia relato');
reset role;

-- Cliente B só enxerga o empreendimento B.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005c2","role":"authenticated"}';
select public.t5a_exige_conta('select count(*) from public.obras', 1, 'cliente B vê só a obra B1');
select public.t5a_exige_conta('select count(*) from public.relatos_obra', 1, 'cliente B vê só o relato aprovado de B1');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where obra_id = '50000000-0000-0000-0000-00000000b0a1'$q$, 0, 'cliente B não vê relatos de A');
select public.t5a_exige_conta('select count(*) from public.relato_fotos', 1, 'cliente B vê só a foto de B1');
reset role;

-- ---------------------------------------------------------------------------
-- Empreiteiro A (da obra A1): vê o que é seu, não escreve direto em fotos nem revisa.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e1","role":"authenticated"}';
select public.t5a_exige_conta('select count(*) from public.obras', 1, 'empreiteiro A vê só a obra A1');
select public.t5a_exige_conta($q$select count(*) from public.obras where id = '50000000-0000-0000-0000-00000000b0a1'$q$, 1, 'empreiteiro A deveria ver a obra A1');
select public.t5a_exige_conta('select count(*) from public.obra_empreiteiros', 1, 'empreiteiro A vê só o próprio vínculo');
select public.t5a_exige_conta('select count(*) from public.relatos_obra', 3, 'empreiteiro A vê os próprios relatos, de qualquer status');
select public.t5a_exige_conta('select count(*) from public.relato_fotos', 2, 'empreiteiro A vê as fotos dos próprios relatos');
select public.t5a_exige_negado(
  $q$insert into public.relato_fotos (relato_id, storage_path, mime, tamanho) values ('50000000-0000-0000-0000-00000000c0a2', 'relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000c0a2/direta.jpg', 'image/jpeg', 10)$q$,
  'empreiteiro não insere foto direto');
select public.t5a_exige_negado(
  $q$insert into public.relatos_obra (obra_id, autor_id, texto, status) values ('50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1', 'Auto-aprovado', 'aprovado')$q$,
  'empreiteiro não insere relato já aprovado');
select public.t5a_exige_negado(
  $q$insert into public.relatos_obra (id, obra_id, autor_id, texto) values ('50000000-0000-0000-0000-00000000d0f1', '50000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-0000000005e1', 'Direto, sem RPC')$q$,
  'empreiteiro não insere relato pendente direto, só pela RPC');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0f1'$q$, 0, 'insert direto negado não pode deixar relato');
select public.t5a_exige_negado(
  $q$update public.relatos_obra set status = 'aprovado' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  'empreiteiro não aprova o próprio relato');
select public.t5a_exige_negado(
  $q$update public.relatos_obra set texto = 'Reescrito pelo autor' where id = '50000000-0000-0000-0000-00000000c0a2'$q$,
  'empreiteiro não edita relato enviado');
select public.t5a_exige_negado(
  $q$update public.obras set percentual = 100, situacao = 'concluida' where id = '50000000-0000-0000-0000-00000000b0a1'$q$,
  'empreiteiro não altera o progresso oficial');
select public.t5a_exige_negado(
  $q$delete from public.obras where id = '50000000-0000-0000-0000-00000000b0a1'$q$,
  'empreiteiro não exclui obra');
select public.t5a_exige_negado(
  $q$delete from public.relatos_obra where id = '50000000-0000-0000-0000-00000000c0a3'$q$,
  'empreiteiro não exclui relato');
select public.t5a_exige_negado(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, 100, 'concluida')$q$,
  'empreiteiro não revisa relato');

-- enviar_relato_obra: outra obra, validações e limites.
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0b1', gen_random_uuid(), 'Obra que não é minha', null, null, '[]'::jsonb)$q$,
  array['42501'], 'envio para obra de outro empreiteiro deveria ser negado');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a2', gen_random_uuid(), 'Obra sem vínculo', null, null, '[]'::jsonb)$q$,
  array['42501'], 'envio para obra sem vínculo deveria ser negado');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'ab', null, null, '[]'::jsonb)$q$,
  array['23514'], 'texto curto deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', 101, null, '[]'::jsonb)$q$,
  array['23514'], 'percentual acima de 100 deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null, public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 11, 'excesso'))$q$,
  array['23514'], 'onze fotos deveriam falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null, public.t5a_fotos('50000000-0000-0000-0000-00000000b0b1', '50000000-0000-0000-0000-00000000d0e1', 1, 'outraobra'))$q$,
  array['23514'], 'foto com caminho de outra obra deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null, public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000c0a2', 1, 'outrorelato'))$q$,
  array['23514'], 'foto com caminho de outro relato deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null,
     '[{"id":"11111111-1111-4111-8111-111111111111","path":"relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000d0e1/11111111-1111-4111-8111-111111111111.png","mime":"image/jpeg","tamanho":10}]'::jsonb)$q$,
  array['23514'], 'extensão incoerente com o MIME deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null,
     '[{"id":"11111111-1111-4111-8111-111111111111","path":"relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000d0e1/11111111-1111-4111-8111-111111111111.jpg","mime":"image/jpeg","tamanho":10485761}]'::jsonb)$q$,
  array['23514'], 'foto acima de 10 MiB deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null,
     '[{"id":"11111111-1111-4111-8111-111111111111","path":"relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000d0e1/11111111-1111-4111-8111-111111111111.jpg","mime":"image/jpeg","tamanho":0}]'::jsonb)$q$,
  array['23514'], 'foto de tamanho zero deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null,
     '[{"id":"11111111-1111-4111-8111-111111111111","path":"relatos/50000000-0000-0000-0000-00000000b0a1/50000000-0000-0000-0000-00000000d0e1/11111111-1111-4111-8111-111111111111.jpg","mime":"image/jpeg","tamanho":10,"extra":"x"}]'::jsonb)$q$,
  array['23514'], 'chave extra na foto deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null,
     (public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'dup') || public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'dup')))$q$,
  array['23514'], 'fotos com id repetido deveriam falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null, public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'semobjeto'))$q$,
  array['23514'], 'foto sem objeto no Storage deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null, public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'tam'))$q$,
  array['23514'], 'foto com tamanho diferente do objeto no Storage deveria falhar');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Texto ok', null, null,
     (public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'r1') || public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 1, 'semobjeto')))$q$,
  array['23514'], 'uma foto sem objeto entre fotos válidas deveria falhar');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e1'$q$, 0, 'envios inválidos não podem deixar relato');

-- Envio válido: relato e fotos nascem juntos; autor é o usuário da sessão.
select public.t5a_exige_conta(
  $q$select count(*) from (select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', '  Concluímos a laje.  ', 40, 'em_andamento',
     public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 2, 'r1')) as id) as x$q$,
  1, 'envio válido com duas fotos');
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e1' and status = 'pendente'
     and autor_id = '00000000-0000-0000-0000-0000000005e1' and texto = 'Concluímos a laje.' and percentual_informado = 40 and situacao_informada = 'em_andamento'$q$,
  1, 'relato deveria nascer pendente, com o autor da sessão e texto aparado');
select public.t5a_exige_conta($q$select count(*) from public.relato_fotos where relato_id = '50000000-0000-0000-0000-00000000d0e1'$q$, 2, 'duas fotos gravadas na mesma transação');
-- Repetição com o mesmo id devolve o id e não duplica nada.
select public.t5a_exige_conta(
  $q$select count(*) from (select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 'Concluímos a laje.', 40, 'em_andamento',
     public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e1', 2, 'r1')) as id) as x$q$,
  1, 'repetição idempotente');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e1'$q$, 1, 'repetição não duplica o relato');
select public.t5a_exige_conta($q$select count(*) from public.relato_fotos where relato_id = '50000000-0000-0000-0000-00000000d0e1'$q$, 2, 'repetição não duplica as fotos');
-- Dez fotos passam; até cinco pendentes por obra (a2 + 4 novos); o sexto falha.
select public.t5a_exige_linhas(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e2', 'Relato com dez fotos', 55, 'em_andamento',
     public.t5a_fotos('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e2', 10, 'r2'))$q$,
  1, 'dez fotos são aceitas');
select public.t5a_exige_linhas(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e3', 'Relato sem fotos', null, null, '[]'::jsonb)$q$,
  1, 'relato sem fotos é aceito');
select public.t5a_exige_linhas(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e4', 'Outro relato sem fotos', 60, 'concluida', '[]'::jsonb)$q$,
  1, 'quarto relato novo é aceito');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', '50000000-0000-0000-0000-00000000d0e5', 'Sexto pendente', null, null, '[]'::jsonb)$q$,
  array['54000'], 'o sexto relato pendente deveria falhar com 54000');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where status = 'pendente'$q$, 5, 'empreiteiro A deveria ter exatamente cinco pendentes');
select public.t5a_exige_conta('select count(*) from public.relato_fotos', 14, 'fotos visíveis ao autor: 2 seed + 2 + 10');
reset role;

-- Auditoria usa o ator real (a RPC security definer preserva auth.uid()); a leitura é do admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}';
select public.t5a_exige_conta(
  $q$select count(*) from public.auditoria where tabela = 'relatos_obra' and acao = 'INSERT'
     and registro_id = '50000000-0000-0000-0000-00000000d0e1' and ator_id = '00000000-0000-0000-0000-0000000005e1'$q$,
  1, 'auditoria do relato deveria registrar o empreiteiro como ator');
select public.t5a_exige_conta(
  $q$select count(*) from public.auditoria where tabela = 'relato_fotos' and acao = 'INSERT'
     and ator_id = '00000000-0000-0000-0000-0000000005e1'$q$,
  12, 'auditoria das 12 fotos novas deveria registrar o empreiteiro como ator');
reset role;

-- Um segundo empreiteiro não reaproveita o id de relato de outro.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e2","role":"authenticated"}';
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0b1', '50000000-0000-0000-0000-00000000d0e1', 'Roubando o id', null, null, '[]'::jsonb)$q$,
  array['42501'], 'id de relato de outro autor não pode ser reaproveitado');
-- Empreiteiro B: só a obra B1, só o relato b1; nada de A.
select public.t5a_exige_conta('select count(*) from public.obras', 1, 'empreiteiro B vê só a obra B1');
select public.t5a_exige_conta('select count(*) from public.relatos_obra', 1, 'empreiteiro B vê só o próprio relato');
select public.t5a_exige_conta('select count(*) from public.relato_fotos', 1, 'empreiteiro B vê só a própria foto');
select public.t5a_exige_conta('select count(*) from public.obra_empreiteiros', 1, 'empreiteiro B vê só o próprio vínculo');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Obra de A', null, null, '[]'::jsonb)$q$,
  array['42501'], 'empreiteiro B não envia para a obra A1');
reset role;

-- Empreiteiro não atribuído, inativo e pendente: nada lê, nada envia.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e3","role":"authenticated"}';
select public.t5a_exige_nada('empreiteiro não atribuído');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Sem vínculo', null, null, '[]'::jsonb)$q$,
  array['42501'], 'empreiteiro não atribuído não envia');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e4","role":"authenticated"}';
select public.t5a_exige_nada('empreiteiro inativo vinculado');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Conta inativa', null, null, '[]'::jsonb)$q$,
  array['42501'], 'empreiteiro inativo não envia');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e5","role":"authenticated"}';
select public.t5a_exige_nada('empreiteiro com troca de senha pendente');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Conta pendente', null, null, '[]'::jsonb)$q$,
  array['42501'], 'empreiteiro pendente não envia');
reset role;

-- Fornecedor não tem acesso a obras nem a relatos.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005f1","role":"authenticated"}';
select public.t5a_exige_nada('fornecedor');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Fornecedor', null, null, '[]'::jsonb)$q$,
  array['42501'], 'fornecedor não envia relato');
reset role;

-- ---------------------------------------------------------------------------
-- Equipe: revisa pela RPC; aprovar ajusta a obra na mesma transação.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005b1","role":"authenticated"}';
select public.t5a_exige_conta('select count(*) from public.relatos_obra', 8, 'equipe vê todos os relatos (4 seed + 4 novos)');
-- Entradas inválidas não deixam rastro (relato continua pendente, obra intacta).
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, null, 'em_andamento')$q$,
  array['23514'], 'aprovar sem percentual deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, 55, null)$q$,
  array['23514'], 'aprovar sem situação deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, 101, 'concluida')$q$,
  array['23514'], 'aprovar com percentual acima de 100 deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'excluir', null, 50, 'concluida')$q$,
  array['23514'], 'ação desconhecida deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000d0e1', 'devolver', null, null, null)$q$,
  array['23514'], 'devolver sem motivo deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000d0e1', 'devolver', '  ab ', null, null)$q$,
  array['23514'], 'devolver com motivo curto deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000d0e1', 'devolver', repeat('x', 501), null, null)$q$,
  array['23514'], 'devolver com motivo acima de 500 deveria falhar');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra(gen_random_uuid(), 'aprovar', null, 50, 'em_andamento')$q$,
  array['P0002'], 'relato inexistente deveria falhar com P0002');
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra r join public.obras o on o.id = r.obra_id
     where r.id = '50000000-0000-0000-0000-00000000c0a2' and r.status = 'pendente' and o.percentual = 10 and o.situacao = 'em_andamento'$q$,
  1, 'tentativas inválidas não podem alterar relato nem obra');

-- Aprovar com ajuste (o empreiteiro disse 40, a equipe confirma 55): relato e obra juntos.
select public.t5a_exige_linhas(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'aprovar', null, 55, 'em_andamento')$q$,
  1, 'aprovar relato pendente');
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra r join public.obras o on o.id = r.obra_id
     where r.id = '50000000-0000-0000-0000-00000000c0a2' and r.status = 'aprovado' and r.motivo_devolucao is null
       and r.revisado_por = '00000000-0000-0000-0000-0000000005b1' and r.revisado_em is not null
       and o.percentual = 55 and o.situacao = 'em_andamento'$q$,
  1, 'aprovação deveria publicar o relato, carimbar o revisor e ajustar a obra');
-- Já revisado: 55000, tanto aprovado quanto devolvido seed.
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a2', 'devolver', 'Tarde demais', null, null)$q$,
  array['55000'], 'relato aprovado não pode ser devolvido depois');
select public.t5a_exige_erro(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000c0a3', 'aprovar', null, 80, 'em_andamento')$q$,
  array['55000'], 'relato devolvido não pode ser aprovado depois');
-- Devolver com motivo: a obra não muda.
select public.t5a_exige_linhas(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000d0e1', 'devolver', 'Faltou a foto da fachada.', 99, 'concluida')$q$,
  1, 'devolver com motivo');
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra r join public.obras o on o.id = r.obra_id
     where r.id = '50000000-0000-0000-0000-00000000d0e1' and r.status = 'devolvido' and r.motivo_devolucao = 'Faltou a foto da fachada.'
       and r.revisado_por = '00000000-0000-0000-0000-0000000005b1'
       and o.percentual = 55 and o.situacao = 'em_andamento'$q$,
  1, 'devolução guarda o motivo e não toca na obra');
-- Aprovação com 10 fotos; a obra de outro empreendimento permanece como está.
select public.t5a_exige_linhas(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000d0e2', 'aprovar', null, 70, 'em_andamento')$q$,
  1, 'aprovar relato com dez fotos');
select public.t5a_exige_conta($q$select count(*) from public.obras where id = '50000000-0000-0000-0000-00000000b0b1' and percentual = 20$q$, 1, 'revisão não toca em outras obras');
-- Equipe também gerencia obras e vínculos.
select public.t5a_exige_linhas(
  $q$update public.obras set nome = 'Obra A2 renomeada Etapa5' where id = '50000000-0000-0000-0000-00000000b0a2'$q$,
  1, 'equipe edita obra');
select public.t5a_exige_linhas(
  $q$insert into public.obra_empreiteiros (obra_id, profile_id) values ('50000000-0000-0000-0000-00000000b0a2', '00000000-0000-0000-0000-0000000005e3')$q$,
  1, 'equipe atribui empreiteiro');
select public.t5a_exige_linhas(
  $q$delete from public.obra_empreiteiros where obra_id = '50000000-0000-0000-0000-00000000b0a2' and profile_id = '00000000-0000-0000-0000-0000000005e3'$q$,
  1, 'equipe remove vínculo');
reset role;

-- ---------------------------------------------------------------------------
-- Admin: também revisa; lê a auditoria com o ator da equipe na revisão.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}';
select public.t5a_exige_linhas(
  $q$select public.revisar_relato_obra('50000000-0000-0000-0000-00000000d0e3', 'aprovar', null, 70, 'em_andamento')$q$,
  1, 'admin aprova relato');
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e3' and status = 'aprovado' and revisado_por = '00000000-0000-0000-0000-0000000005a1'$q$,
  1, 'o carimbo do revisor deveria ser o admin');
select public.t5a_exige_conta(
  $q$select count(*) from public.auditoria where tabela = 'relatos_obra' and acao = 'UPDATE'
     and registro_id = '50000000-0000-0000-0000-00000000c0a2' and ator_id = '00000000-0000-0000-0000-0000000005b1'$q$,
  1, 'auditoria da revisão deveria registrar a equipe como ator');
select public.t5a_exige_conta(
  $q$select (count(*) >= 2)::int from public.auditoria where tabela = 'obras' and acao = 'UPDATE'
     and registro_id = '50000000-0000-0000-0000-00000000b0a1' and ator_id = '00000000-0000-0000-0000-0000000005b1'$q$,
  1, 'auditoria dos dois ajustes da obra deveria registrar a equipe como ator');
reset role;

-- ---------------------------------------------------------------------------
-- Cliente A depois das revisões: só vê o que foi aprovado (a1, a2, d0e2, d0e3).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005c1","role":"authenticated"}';
select public.t5a_exige_conta('select count(*) from public.relatos_obra', 4, 'cliente A vê os quatro relatos aprovados');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where status <> 'aprovado'$q$, 0, 'cliente A nunca vê pendente nem devolvido');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e1'$q$, 0, 'relato devolvido continua invisível ao cliente');
select public.t5a_exige_conta($q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e4'$q$, 0, 'relato pendente continua invisível ao cliente');
select public.t5a_exige_conta('select count(*) from public.relato_fotos', 12, 'cliente A vê as fotos só dos aprovados (1 + 1 + 10)');
select public.t5a_exige_conta($q$select count(*) from public.obras where id = '50000000-0000-0000-0000-00000000b0a1' and percentual = 70$q$, 1, 'cliente A vê o progresso oficial ajustado');
reset role;

-- ---------------------------------------------------------------------------
-- Empreiteiro A vê o devolvido com motivo; ao ser desvinculado, perde relatos e fotos.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e1","role":"authenticated"}';
select public.t5a_exige_conta(
  $q$select count(*) from public.relatos_obra where id = '50000000-0000-0000-0000-00000000d0e1' and status = 'devolvido' and motivo_devolucao = 'Faltou a foto da fachada.'$q$,
  1, 'autor vê o motivo da devolução');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005b1","role":"authenticated"}';
select public.t5a_exige_linhas(
  $q$delete from public.obra_empreiteiros where obra_id = '50000000-0000-0000-0000-00000000b0a1' and profile_id = '00000000-0000-0000-0000-0000000005e1'$q$,
  1, 'equipe remove o vínculo do empreiteiro A');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005e1","role":"authenticated"}';
select public.t5a_exige_nada('empreiteiro A desvinculado');
select public.t5a_exige_erro(
  $q$select public.enviar_relato_obra('50000000-0000-0000-0000-00000000b0a1', gen_random_uuid(), 'Depois do desvínculo', null, null, '[]'::jsonb)$q$,
  array['42501'], 'empreiteiro desvinculado não envia mais');
reset role;

select 'OK: todas as verificações da Etapa 5 (obras e empreiteiro) passaram' as resultado;

rollback;
