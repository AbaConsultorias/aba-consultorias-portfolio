-- Testes da Etapa 7 — reservar_envio_conector e confirmar_envio_conector (migration 20261104110000_etapa7_conector_atomico.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa7_conector_atomico.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa7_conector_atomico.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
-- O teste insere o próprio conector ativo: o banco não pode ter outro conector ativo (índice conectores_um_ativo_idx).
-- Concorrência não dá para testar numa sessão: aqui se testa a lógica (limites, idempotência, duplicado,
-- tudo-ou-nada) e as permissões; o lock por conector e o índice único cobrem a corrida.
--
-- Fixture (ids com prefixo 72000000-...):
--   empreendimento (e01); regras a1 ('01 - TESTE', grupo contratos) e a2 ('02 - OUTRA', grupo orcamentos);
--   conectores c01 (ativo), c02, c03, c04 (revogados, só para isolar contagens).
--   Envio n usa documento 72000000-0000-0000-0000-<n com 12 dígitos> e caminho teste/arquivo-<n>.pdf.

begin;

-- O banco aceita um só conector ativo, e o de produção já existe. Revogá-lo aqui vale só dentro
-- desta transação, que termina em ROLLBACK: o conector real não é afetado.
update public.conectores set revogado_em = now() where revogado_em is null;

insert into public.empreendimentos (id, nome, codigo_pasta)
values ('72000000-0000-0000-0000-000000000e01', 'Empreendimento Teste E7 Atômico', '727272');

insert into public.pasta_regras (id, empreendimento_id, caminho_prefixo, grupo, liberar_automatico, ativa)
values
  ('72000000-0000-0000-0000-0000000000a1', '72000000-0000-0000-0000-000000000e01', '01 - TESTE', 'contratos', false, true),
  ('72000000-0000-0000-0000-0000000000a2', '72000000-0000-0000-0000-000000000e01', '02 - OUTRA', 'orcamentos', false, true);

insert into public.conectores (id, nome, token_hash, revogado_em)
values
  ('72000000-0000-0000-0000-000000000c01', 'Conector teste atômico', repeat('c', 64), null),
  ('72000000-0000-0000-0000-000000000c02', 'Conector teste B', repeat('d', 64), now()),
  ('72000000-0000-0000-0000-000000000c03', 'Conector teste C', repeat('e', 64), now()),
  ('72000000-0000-0000-0000-000000000c04', 'Conector teste D', repeat('f', 64), now());

create function pg_temp.doc(p_n int) returns uuid language sql immutable as $$
  select ('72000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create function pg_temp.reservar(
  p_conector uuid, p_n int, p_regra uuid, p_tamanho bigint, p_agora timestamptz, p_limite_envios int, p_limite_bytes bigint
) returns jsonb language sql as $$
  select public.reservar_envio_conector(
    p_conector,
    '72000000-0000-0000-0000-000000000e01'::uuid,
    p_regra,
    'teste/arquivo-' || p_n || '.pdf',
    p_tamanho,
    lpad(p_n::text, 64, '0'),
    p_agora,
    pg_temp.doc(p_n),
    '72000000-0000-0000-0000-000000000e01/72000000-0000-0000-0000-' || lpad(p_n::text, 12, '0') || '.pdf',
    p_agora,
    p_limite_envios,
    p_limite_bytes
  )
$$;

-- ---------------------------------------------------------------------------
-- reservar_envio_conector: limites por quantidade e por bytes, janela móvel, isolamento por conector.
-- ---------------------------------------------------------------------------

do $$
declare
  v_emp uuid := '72000000-0000-0000-0000-000000000e01';
  v_a uuid := '72000000-0000-0000-0000-000000000c01';
  v_b uuid := '72000000-0000-0000-0000-000000000c02';
  v_c uuid := '72000000-0000-0000-0000-000000000c03';
  v_d uuid := '72000000-0000-0000-0000-000000000c04';
  v_regra uuid := '72000000-0000-0000-0000-0000000000a1';
  v_t0 timestamptz := timestamptz '2026-06-01 10:00:00+00';
  v_r jsonb;
  v_linha public.conector_envios%rowtype;
begin
  -- Limite de 2 envios: os dois primeiros passam, o terceiro não, e nada é gravado para ele.
  v_r := pg_temp.reservar(v_a, 1, v_regra, 100, v_t0, 2, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: 1º envio não reservado: %', v_r;
  end if;

  select e.* into v_linha from public.conector_envios e where e.id = (v_r ->> 'envio_id')::uuid;
  if not found
     or v_linha.estado is distinct from 'autorizado'
     or v_linha.conector_id is distinct from v_a
     or v_linha.empreendimento_id is distinct from v_emp
     or v_linha.regra_id is distinct from v_regra
     or v_linha.caminho_relativo is distinct from 'teste/arquivo-1.pdf'
     or v_linha.tamanho is distinct from 100
     or v_linha.sha256 is distinct from lpad('1', 64, '0')
     or v_linha.mtime is distinct from v_t0
     or v_linha.em is distinct from v_t0
     or v_linha.documento_planejado_id is distinct from pg_temp.doc(1)
     or v_linha.storage_path is distinct from v_emp::text || '/' || pg_temp.doc(1)::text || '.pdf'
     or v_linha.documento_id is not null
     or v_linha.confirmado_em is not null then
    raise exception 'FALHA: linha reservada diferente do esperado: %', to_jsonb(v_linha);
  end if;

  v_r := pg_temp.reservar(v_a, 2, v_regra, 100, v_t0 + interval '1 hour', 2, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: 2º envio não reservado: %', v_r;
  end if;

  v_r := pg_temp.reservar(v_a, 3, v_regra, 100, v_t0 + interval '2 hours', 2, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from false or (v_r ->> 'tentar_depois_s')::int is distinct from 79200 then
    raise exception 'FALHA: 3º envio deveria estourar o limite e esperar 79200 s (22 h), veio %', v_r;
  end if;
  if v_r ->> 'envio_id' is not null then
    raise exception 'FALHA: envio acima do limite devolveu envio_id: %', v_r;
  end if;
  if exists (select 1 from public.conector_envios e where e.documento_planejado_id = pg_temp.doc(3))
     or (select count(*) from public.conector_envios e where e.conector_id = v_a) is distinct from 2 then
    raise exception 'FALHA: envio acima do limite foi gravado';
  end if;

  -- O limite é por conector: outra chave não é afetada.
  v_r := pg_temp.reservar(v_b, 4, v_regra, 100, v_t0 + interval '2 hours', 2, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: limite de um conector barrou outro: %', v_r;
  end if;

  -- Janela móvel: um segundo antes de o 1º sair ainda não cabe (espera de 1 s); no instante exato cabe.
  v_r := pg_temp.reservar(v_a, 5, v_regra, 100, v_t0 + interval '24 hours' - interval '1 second', 2, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from false or (v_r ->> 'tentar_depois_s')::int is distinct from 1 then
    raise exception 'FALHA: 1 s antes de sair da janela deveria esperar 1 s, veio %', v_r;
  end if;
  v_r := pg_temp.reservar(v_a, 5, v_regra, 100, v_t0 + interval '24 hours', 2, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: envio no instante em que o mais antigo sai da janela não foi reservado: %', v_r;
  end if;

  -- Limite de bytes (1000): 600 + 400 cabem; mais 1 byte não.
  v_r := pg_temp.reservar(v_c, 10, v_regra, 600, v_t0, 100, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: 600 bytes não reservados: %', v_r;
  end if;
  v_r := pg_temp.reservar(v_c, 11, v_regra, 400, v_t0 + interval '1 hour', 100, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: 400 bytes (total 1000, no limite) não reservados: %', v_r;
  end if;
  v_r := pg_temp.reservar(v_c, 12, v_regra, 1, v_t0 + interval '2 hours', 100, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from false or (v_r ->> 'tentar_depois_s')::int is distinct from 79200 then
    raise exception 'FALHA: 1001 bytes deveriam estourar e esperar 79200 s, veio %', v_r;
  end if;
  -- 700 bytes só cabem quando os dois saem da janela: espera até o 2º (23 h depois de agora).
  v_r := pg_temp.reservar(v_c, 13, v_regra, 700, v_t0 + interval '2 hours', 100, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from false or (v_r ->> 'tentar_depois_s')::int is distinct from 82800 then
    raise exception 'FALHA: 700 bytes deveriam esperar 82800 s, veio %', v_r;
  end if;
  if exists (select 1 from public.conector_envios e where e.documento_planejado_id in (pg_temp.doc(12), pg_temp.doc(13))) then
    raise exception 'FALHA: envio acima do limite de bytes foi gravado';
  end if;

  -- Recusado, duplicado e autorizado fora da janela não contam.
  insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado, em)
  values
    (v_d, v_emp, 'x/rec.pdf', 500, repeat('a', 64), 'recusado', v_t0),
    (v_d, v_emp, 'x/dup.pdf', 500, repeat('b', 64), 'duplicado', v_t0),
    (v_d, v_emp, 'x/velho.pdf', 500, repeat('c', 64), 'autorizado', v_t0 - interval '25 hours');
  v_r := pg_temp.reservar(v_d, 20, v_regra, 500, v_t0 + interval '1 hour', 1, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: recusado/duplicado/fora da janela contaram para o limite: %', v_r;
  end if;
  v_r := pg_temp.reservar(v_d, 21, v_regra, 1, v_t0 + interval '1 hour', 1, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from false then
    raise exception 'FALHA: 2º envio do conector D deveria estourar o limite de 1: %', v_r;
  end if;

  -- Envio confirmado conta (a janela vale para autorizado + confirmado).
  update public.conector_envios set estado = 'confirmado', confirmado_em = v_t0, documento_id = null
   where documento_planejado_id = pg_temp.doc(20);
  v_r := pg_temp.reservar(v_d, 22, v_regra, 1, v_t0 + interval '1 hour', 1, 1000);
  if (v_r ->> 'reservado')::boolean is distinct from false then
    raise exception 'FALHA: envio confirmado não contou para o limite: %', v_r;
  end if;

  -- Parâmetros ausentes falham (comparação com NULL liberaria o envio).
  begin
    perform public.reservar_envio_conector(v_a, v_emp, v_regra, 'x.pdf', 1, repeat('1', 64), null, pg_temp.doc(90),
                                           v_emp::text || '/' || pg_temp.doc(90)::text || '.pdf', v_t0, null, 1000);
    raise exception 'FALHA: limite nulo aceito';
  exception when check_violation then
    null;
  end;
  begin
    perform public.reservar_envio_conector(v_a, v_emp, v_regra, 'x.pdf', 1, repeat('1', 64), null, pg_temp.doc(90),
                                           v_emp::text || '/' || pg_temp.doc(90)::text || '.pdf', null, 10, 1000);
    raise exception 'FALHA: relógio nulo aceito';
  exception when check_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- confirmar_envio_conector
-- ---------------------------------------------------------------------------

do $$
declare
  v_emp uuid := '72000000-0000-0000-0000-000000000e01';
  v_a uuid := '72000000-0000-0000-0000-000000000c01';
  v_b uuid := '72000000-0000-0000-0000-000000000c02';
  v_regra uuid := '72000000-0000-0000-0000-0000000000a1';
  v_regra2 uuid := '72000000-0000-0000-0000-0000000000a2';
  v_t0 timestamptz := timestamptz '2026-06-01 10:00:00+00';
  v_t1 timestamptz := timestamptz '2026-06-01 10:30:00+00';
  v_r jsonb;
  v_envio uuid;
  v_doc public.documentos%rowtype;
  v_origem public.documento_origens%rowtype;
  v_linha public.conector_envios%rowtype;
  v_documentos_antes bigint;
begin
  -- Confirmação normal: documento oculto com o destino da regra, origem e envio confirmado.
  v_r := pg_temp.reservar(v_a, 30, v_regra, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Título 30', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'confirmado' or (v_r ->> 'novo')::boolean is distinct from true
     or (v_r ->> 'documento_id')::uuid is distinct from pg_temp.doc(30) then
    raise exception 'FALHA: confirmação normal devolveu %', v_r;
  end if;

  select d.* into v_doc from public.documentos d where d.id = pg_temp.doc(30);
  if not found
     or v_doc.empreendimento_id is distinct from v_emp
     or v_doc.titulo is distinct from 'Título 30'
     or v_doc.grupo is distinct from 'contratos'
     or v_doc.projeto_id is not null
     or v_doc.categoria_id is not null
     or v_doc.liberado_cliente
     or v_doc.liberado_em is not null
     or v_doc.mime is distinct from 'application/pdf'
     or v_doc.tamanho is distinct from 100
     or v_doc.sha256 is distinct from lpad('30', 64, '0')
     or v_doc.storage_path is distinct from v_emp::text || '/' || pg_temp.doc(30)::text || '.pdf'
     or v_doc.substitui_id is not null then
    raise exception 'FALHA: documento criado diferente do esperado: %', to_jsonb(v_doc);
  end if;

  select o.* into v_origem from public.documento_origens o where o.documento_id = pg_temp.doc(30);
  if not found
     or v_origem.conector_id is distinct from v_a
     or v_origem.regra_id is distinct from v_regra
     or v_origem.caminho_relativo is distinct from 'teste/arquivo-30.pdf'
     or v_origem.tamanho is distinct from 100
     or v_origem.sha256 is distinct from lpad('30', 64, '0')
     or v_origem.mtime is distinct from v_t0 then
    raise exception 'FALHA: origem criada diferente do esperado: %', to_jsonb(v_origem);
  end if;

  select e.* into v_linha from public.conector_envios e where e.id = v_envio;
  if v_linha.estado is distinct from 'confirmado' or v_linha.documento_id is distinct from pg_temp.doc(30) or v_linha.confirmado_em is distinct from v_t1 then
    raise exception 'FALHA: envio não ficou confirmado com documento e data: %', to_jsonb(v_linha);
  end if;

  -- Idempotente: confirmar de novo devolve o mesmo documento, sem criar nada.
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Outro título', null, v_t1 + interval '1 hour', null, null);
  if v_r ->> 'situacao' is distinct from 'confirmado' or (v_r ->> 'novo')::boolean is distinct from false
     or (v_r ->> 'documento_id')::uuid is distinct from pg_temp.doc(30) then
    raise exception 'FALHA: confirmar de novo devolveu %', v_r;
  end if;
  if (select count(*) from public.documentos d where d.empreendimento_id = v_emp) is distinct from 1
     or (select count(*) from public.documento_origens o where o.conector_id = v_a) is distinct from 1
     or (select d.titulo from public.documentos d where d.id = pg_temp.doc(30)) is distinct from 'Título 30'
     or (select e.confirmado_em from public.conector_envios e where e.id = v_envio) is distinct from v_t1 then
    raise exception 'FALHA: confirmar de novo alterou ou duplicou dados';
  end if;

  -- Duplicado: outro envio com o mesmo conteúdo já confirmado no empreendimento. Nada fica (nem documento nem origem).
  v_r := pg_temp.reservar(v_a, 31, v_regra, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  update public.conector_envios set sha256 = lpad('30', 64, '0') where id = v_envio;
  select count(*) into v_documentos_antes from public.documentos;
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Cópia', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'duplicado' then
    raise exception 'FALHA: conteúdo repetido deveria ser duplicado, veio %', v_r;
  end if;
  if exists (select 1 from public.documentos d where d.id = pg_temp.doc(31))
     or exists (select 1 from public.documento_origens o where o.documento_id = pg_temp.doc(31))
     or (select count(*) from public.documentos) is distinct from v_documentos_antes then
    raise exception 'FALHA: duplicado deixou documento ou origem';
  end if;
  select e.* into v_linha from public.conector_envios e where e.id = v_envio;
  if v_linha.estado is distinct from 'autorizado' or v_linha.documento_id is not null or v_linha.confirmado_em is not null then
    raise exception 'FALHA: duplicado alterou o envio (a API é quem o marca): %', to_jsonb(v_linha);
  end if;

  -- Regra desativada: sem_regra; reativada, o mesmo envio confirma.
  v_r := pg_temp.reservar(v_a, 32, v_regra, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  update public.pasta_regras set ativa = false where id = v_regra;
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Regra off', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'sem_regra' or exists (select 1 from public.documentos d where d.id = pg_temp.doc(32)) then
    raise exception 'FALHA: regra desativada deveria dar sem_regra sem documento, veio %', v_r;
  end if;
  update public.pasta_regras set ativa = true where id = v_regra;
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Regra on', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'confirmado' then
    raise exception 'FALHA: com a regra reativada o envio deveria confirmar, veio %', v_r;
  end if;

  -- Regra apagada (regra_id vira nulo no envio): sem_regra. Regra de outro destino: usa o grupo dela.
  v_r := pg_temp.reservar(v_a, 33, v_regra2, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  v_r := pg_temp.reservar(v_a, 36, v_regra2, 100, v_t0, 1000, 1000000000000);
  v_r := public.confirmar_envio_conector((v_r ->> 'envio_id')::uuid, v_a, 'Orçamento', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'confirmado'
     or (select d.grupo from public.documentos d where d.id = pg_temp.doc(36)) is distinct from 'orcamentos' then
    raise exception 'FALHA: documento da regra 2 deveria ir para o grupo orcamentos, veio %', v_r;
  end if;
  delete from public.pasta_regras where id = v_regra2;
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Sem regra', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'sem_regra' or exists (select 1 from public.documentos d where d.id = pg_temp.doc(33)) then
    raise exception 'FALHA: regra apagada deveria dar sem_regra sem documento, veio %', v_r;
  end if;

  -- Revisão: aponta o documento anterior e herda a família. Anterior inexistente vale como sem anterior.
  v_r := pg_temp.reservar(v_a, 34, v_regra, 100, v_t0, 1000, 1000000000000);
  v_r := public.confirmar_envio_conector((v_r ->> 'envio_id')::uuid, v_a, 'Revisão', pg_temp.doc(30), v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'confirmado' then
    raise exception 'FALHA: revisão não confirmou: %', v_r;
  end if;
  if (select d.substitui_id from public.documentos d where d.id = pg_temp.doc(34)) is distinct from pg_temp.doc(30)
     or (select d.familia_id from public.documentos d where d.id = pg_temp.doc(34))
        is distinct from (select d.familia_id from public.documentos d where d.id = pg_temp.doc(30))
     or (select d.liberado_cliente from public.documentos d where d.id = pg_temp.doc(34)) then
    raise exception 'FALHA: revisão sem substitui_id/família ou já liberada';
  end if;
  v_r := pg_temp.reservar(v_a, 35, v_regra, 100, v_t0, 1000, 1000000000000);
  v_r := public.confirmar_envio_conector((v_r ->> 'envio_id')::uuid, v_a, 'Anterior sumiu', '72000000-0000-0000-0000-00000000dead', v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'confirmado'
     or (select d.substitui_id from public.documentos d where d.id = pg_temp.doc(35)) is not null then
    raise exception 'FALHA: anterior inexistente deveria virar sem anterior: %', v_r;
  end if;

  -- Envio que não confirma: recusado, de outro conector, inexistente.
  v_r := pg_temp.reservar(v_a, 37, v_regra, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  update public.conector_envios set estado = 'recusado', erro = 'teste' where id = v_envio;
  v_r := public.confirmar_envio_conector(v_envio, v_a, 'Recusado', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'nao_autorizado' or exists (select 1 from public.documentos d where d.id = pg_temp.doc(37)) then
    raise exception 'FALHA: envio recusado deveria dar nao_autorizado, veio %', v_r;
  end if;

  v_r := pg_temp.reservar(v_a, 38, v_regra, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  v_r := public.confirmar_envio_conector(v_envio, v_b, 'Alheio', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'nao_autorizado'
     or exists (select 1 from public.documentos d where d.id = pg_temp.doc(38))
     or (select e.estado from public.conector_envios e where e.id = v_envio) is distinct from 'autorizado' then
    raise exception 'FALHA: envio de outro conector deveria dar nao_autorizado sem efeito, veio %', v_r;
  end if;
  v_r := public.confirmar_envio_conector('72000000-0000-0000-0000-00000000ffff', v_a, 'Nenhum', null, v_t1, null, null);
  if v_r ->> 'situacao' is distinct from 'nao_autorizado' then
    raise exception 'FALHA: envio inexistente deveria dar nao_autorizado, veio %', v_r;
  end if;

  -- Tudo ou nada: se a origem falha depois de o documento ser inserido (caminho inválido para documento_origens),
  -- a função aborta e nada fica — nem documento sem origem, nem envio confirmado.
  v_r := pg_temp.reservar(v_a, 39, v_regra, 100, v_t0, 1000, 1000000000000);
  v_envio := (v_r ->> 'envio_id')::uuid;
  update public.conector_envios set caminho_relativo = '../fora.pdf' where id = v_envio;
  begin
    perform public.confirmar_envio_conector(v_envio, v_a, 'Parcial', null, v_t1, null, null);
    raise exception 'FALHA: confirmação com origem inválida não falhou';
  exception when check_violation then
    null;
  end;
  if exists (select 1 from public.documentos d where d.id = pg_temp.doc(39))
     or exists (select 1 from public.documento_origens o where o.documento_id = pg_temp.doc(39))
     or (select e.estado from public.conector_envios e where e.id = v_envio) is distinct from 'autorizado'
     or (select e.documento_id from public.conector_envios e where e.id = v_envio) is not null then
    raise exception 'FALHA: confirmação que falhou no meio deixou rastro';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões: só service_role executa; nem public, nem anon, nem authenticated.
-- ---------------------------------------------------------------------------

do $$
declare
  v_funcao regprocedure;
begin
  foreach v_funcao in array array[
    'public.reservar_envio_conector(uuid, uuid, uuid, text, bigint, text, timestamptz, uuid, text, timestamptz, int, bigint)'::regprocedure,
    'public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_funcao, 'execute') then
      raise exception 'FALHA: anon executa %', v_funcao;
    end if;
    if has_function_privilege('authenticated', v_funcao, 'execute') then
      raise exception 'FALHA: authenticated executa %', v_funcao;
    end if;
    if not has_function_privilege('service_role', v_funcao, 'execute') then
      raise exception 'FALHA: service_role não executa %', v_funcao;
    end if;
    -- grantee 0 = PUBLIC; proacl nulo = privilégios padrão (PUBLIC executa).
    if exists (select 1 from pg_proc p where p.oid = v_funcao and p.proacl is null)
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = v_funcao and a.grantee = 0) then
      raise exception 'FALHA: PUBLIC executa %', v_funcao;
    end if;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_funcao
         and p.prosecdef
         and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    ) then
      raise exception 'FALHA: % não é security definer com search_path fixo', v_funcao;
    end if;
  end loop;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"72000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

do $$
begin
  begin
    perform public.reservar_envio_conector(null::uuid, null::uuid, null::uuid, null::text, null::bigint, null::text,
                                           null::timestamptz, null::uuid, null::text, null::timestamptz, null::int, null::bigint);
    raise exception 'FALHA: authenticated executou reservar_envio_conector';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.confirmar_envio_conector(null::uuid, null::uuid, null::text, null::uuid, null::timestamptz, null::text, null::text);
    raise exception 'FALHA: authenticated executou confirmar_envio_conector';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform public.reservar_envio_conector(null::uuid, null::uuid, null::uuid, null::text, null::bigint, null::text,
                                           null::timestamptz, null::uuid, null::text, null::timestamptz, null::int, null::bigint);
    raise exception 'FALHA: anon executou reservar_envio_conector';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.confirmar_envio_conector(null::uuid, null::uuid, null::text, null::uuid, null::timestamptz, null::text, null::text);
    raise exception 'FALHA: anon executou confirmar_envio_conector';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
  v_r jsonb;
begin
  v_r := public.confirmar_envio_conector('72000000-0000-0000-0000-00000000ffff', '72000000-0000-0000-0000-000000000c01',
                                         'x', null, now(), null, null);
  if v_r ->> 'situacao' is distinct from 'nao_autorizado' then
    raise exception 'FALHA: service_role não conseguiu chamar confirmar_envio_conector: %', v_r;
  end if;
  v_r := public.reservar_envio_conector(
    '72000000-0000-0000-0000-000000000c01', '72000000-0000-0000-0000-000000000e01', '72000000-0000-0000-0000-0000000000a1',
    'teste/service.pdf', 10, repeat('7', 64), null, '72000000-0000-0000-0000-000000000a99',
    '72000000-0000-0000-0000-000000000e01/72000000-0000-0000-0000-000000000a99.pdf', now(), 1000, 1000000);
  if (v_r ->> 'reservado')::boolean is distinct from true then
    raise exception 'FALHA: service_role não conseguiu chamar reservar_envio_conector: %', v_r;
  end if;
end $$;

reset role;

select 'OK: reservar_envio_conector e confirmar_envio_conector da Etapa 7 passaram nos testes' as resultado;

rollback;
