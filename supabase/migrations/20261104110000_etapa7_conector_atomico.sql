-- Etapa 7 — correções da revisão de segurança da API do conector: duas operações que a API fazia em
-- vários passos passam a ser uma transação só.
-- 1. reservar_envio_conector: o limite diário (200 envios, 2 GB) era uma consulta e um INSERT separados,
--    então pedidos simultâneos passavam do limite. Agora a contagem e o INSERT ficam sob um lock por conector.
-- 2. confirmar_envio_conector: o documento, a origem e o envio confirmado eram três escritas separadas; se a
--    segunda falhasse, o envio vencia em 1 h com um documento sem origem. Agora é tudo ou nada.
-- Só a API (secret key = service_role) chama as duas; nenhum papel de usuário tem EXECUTE.
begin;

-- ---------------------------------------------------------------------------
-- 1. reservar_envio_conector
-- ---------------------------------------------------------------------------

-- Janela móvel de 24 h sobre os envios 'autorizado' e 'confirmado' do conector (recusados e duplicados não
-- contam). Devolve {"reservado": true, "envio_id": ...} depois de inserir a linha 'autorizado', ou
-- {"reservado": false, "tentar_depois_s": n} quando o envio novo não cabe: n é o tempo até os envios mais
-- antigos saírem da janela o bastante para ele caber. Os limites vêm como parâmetro (a API tem as constantes).
create function public.reservar_envio_conector(
  p_conector uuid,
  p_empreendimento uuid,
  p_regra uuid,
  p_caminho text,
  p_tamanho bigint,
  p_sha256 text,
  p_mtime timestamptz,
  p_documento uuid,
  p_storage_path text,
  p_agora timestamptz,
  p_limite_envios int,
  p_limite_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantidade bigint;
  v_bytes bigint;
  v_libera timestamptz;
  v_antigo record;
  v_envio_id uuid;
begin
  -- Sem limite ou sem relógio a comparação daria NULL e o envio passaria: falha em vez de liberar.
  if p_conector is null or p_tamanho is null or p_agora is null or p_limite_envios is null or p_limite_bytes is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '23514';
  end if;

  -- Serializa os pedidos da mesma chave até o fim da transação: o segundo conta o que o primeiro gravou.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('conector_envios:' || p_conector::text, 0));

  select count(*), coalesce(sum(e.tamanho), 0)::bigint
    into v_quantidade, v_bytes
    from public.conector_envios e
   where e.conector_id = p_conector
     and e.estado in ('autorizado', 'confirmado')
     and e.em > p_agora - interval '24 hours';

  if v_quantidade + 1 > p_limite_envios or v_bytes + p_tamanho > p_limite_bytes then
    v_libera := p_agora + interval '24 hours';
    for v_antigo in
      select e.tamanho, e.em
        from public.conector_envios e
       where e.conector_id = p_conector
         and e.estado in ('autorizado', 'confirmado')
         and e.em > p_agora - interval '24 hours'
       order by e.em, e.id
    loop
      v_quantidade := v_quantidade - 1;
      v_bytes := v_bytes - v_antigo.tamanho;
      v_libera := v_antigo.em + interval '24 hours';
      exit when v_quantidade + 1 <= p_limite_envios and v_bytes + p_tamanho <= p_limite_bytes;
    end loop;

    return jsonb_build_object(
      'reservado', false,
      'tentar_depois_s', greatest(1, ceil(extract(epoch from (v_libera - p_agora))))::int
    );
  end if;

  insert into public.conector_envios (
    conector_id, empreendimento_id, regra_id, caminho_relativo, tamanho, sha256, mtime,
    estado, storage_path, documento_planejado_id, em
  )
  values (
    p_conector, p_empreendimento, p_regra, p_caminho, p_tamanho, p_sha256, p_mtime,
    'autorizado', p_storage_path, p_documento, p_agora
  )
  returning id into v_envio_id;

  return jsonb_build_object('reservado', true, 'envio_id', v_envio_id);
end;
$$;

revoke execute on function public.reservar_envio_conector(uuid, uuid, uuid, text, bigint, text, timestamptz, uuid, text, timestamptz, int, bigint)
  from public, anon, authenticated;
grant execute on function public.reservar_envio_conector(uuid, uuid, uuid, text, bigint, text, timestamptz, uuid, text, timestamptz, int, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. confirmar_envio_conector
-- ---------------------------------------------------------------------------

-- Confirma um envio 'autorizado' do conector: cria o documento (oculto, com o id planejado e o destino da regra
-- do envio), a linha de documento_origens e marca o envio 'confirmado', tudo na mesma transação. A conferência
-- do objeto no R2 e do caminho contra as regras atuais é da API, antes da chamada. Devolve:
--   {"situacao": "confirmado", "documento_id": ..., "novo": true}   confirmou agora;
--   {"situacao": "confirmado", "documento_id": ..., "novo": false}  já estava confirmado (idempotente);
--   {"situacao": "duplicado"}       outro envio confirmou o mesmo conteúdo no empreendimento; nada foi criado;
--   {"situacao": "sem_regra"}       a regra do envio foi apagada ou desativada;
--   {"situacao": "nao_autorizado"}  envio inexistente, de outro conector ou em estado que não confirma.
-- p_substitui: documento da versão anterior do mesmo caminho; se já não existir, vale como sem anterior.
create function public.confirmar_envio_conector(
  p_envio uuid,
  p_conector uuid,
  p_titulo text,
  p_substitui uuid,
  p_agora timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_envio public.conector_envios%rowtype;
  v_regra public.pasta_regras%rowtype;
  v_substitui uuid := p_substitui;
  v_constraint text;
begin
  select e.* into v_envio
    from public.conector_envios e
   where e.id = p_envio and e.conector_id = p_conector
   for update;

  if not found then
    return jsonb_build_object('situacao', 'nao_autorizado');
  end if;
  if v_envio.estado = 'confirmado' then
    return jsonb_build_object('situacao', 'confirmado', 'documento_id', v_envio.documento_id, 'novo', false);
  end if;
  if v_envio.estado <> 'autorizado' or v_envio.storage_path is null or v_envio.documento_planejado_id is null then
    return jsonb_build_object('situacao', 'nao_autorizado');
  end if;

  select r.* into v_regra
    from public.pasta_regras r
   where r.id = v_envio.regra_id and r.ativa;

  if not found then
    return jsonb_build_object('situacao', 'sem_regra');
  end if;

  if v_substitui is not null and not exists (
    select 1 from public.documentos d
     where d.id = v_substitui and d.empreendimento_id = v_envio.empreendimento_id
  ) then
    v_substitui := null;
  end if;

  -- Bloco com tratamento de erro = subtransação: se o índice único (empreendimento_id, sha256) confirmado
  -- acusar a corrida, o documento e a origem inseridos acima dele são desfeitos junto.
  begin
    insert into public.documentos (
      id, empreendimento_id, projeto_id, categoria_id, grupo, titulo, storage_path, mime, tamanho, sha256,
      liberado_cliente, substitui_id
    )
    values (
      v_envio.documento_planejado_id, v_envio.empreendimento_id, v_regra.projeto_id, v_regra.categoria_id,
      v_regra.grupo, p_titulo, v_envio.storage_path, 'application/pdf', v_envio.tamanho, v_envio.sha256,
      false, v_substitui
    );

    insert into public.documento_origens (
      documento_id, conector_id, regra_id, caminho_relativo, tamanho, sha256, mtime
    )
    values (
      v_envio.documento_planejado_id, p_conector, v_regra.id, v_envio.caminho_relativo, v_envio.tamanho,
      v_envio.sha256, v_envio.mtime
    );

    update public.conector_envios
       set estado = 'confirmado',
           documento_id = v_envio.documento_planejado_id,
           confirmado_em = p_agora
     where id = v_envio.id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'conector_envios_confirmado_sha256_idx' then
      return jsonb_build_object('situacao', 'duplicado');
    end if;
    raise;
  end;

  return jsonb_build_object('situacao', 'confirmado', 'documento_id', v_envio.documento_planejado_id, 'novo', true);
end;
$$;

revoke execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz)
  to service_role;

commit;
