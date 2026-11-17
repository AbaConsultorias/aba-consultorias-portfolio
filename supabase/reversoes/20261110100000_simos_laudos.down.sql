-- Desfaz supabase/migrations/20261110100000_simos_laudos.sql: volta confirmar_envio_conector à assinatura de 5
-- parâmetros (texto de 20261104110000_etapa7_conector_atomico.sql), validar_pasta_regra ao texto de
-- 20261103100000_etapa7_conector.sql e tira as colunas novas.
-- O código que usa a regra 'equipamentos' e a rota de visualização precisa voltar junto. Rode à mão, com o usuário postgres.
-- Perda de dados: as regras do tipo 'equipamentos' são apagadas (os documentos já recebidos ficam, como documentos
-- comuns na categoria SIMOS/Laudos) e equipamento/equipamento_papel de todos os documentos são descartados.

begin;

delete from public.pasta_regras where tipo = 'equipamentos';

drop function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text);

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

create or replace function public.validar_pasta_regra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revalidar boolean;
begin
  if tg_op = 'UPDATE' then
    if new.empreendimento_id <> old.empreendimento_id then
      raise exception 'Regra não pode ser transferida.' using errcode = '23514';
    end if;
    v_revalidar := new.projeto_id is distinct from old.projeto_id
      or (new.categoria_id is not null and new.categoria_id is distinct from old.categoria_id);
  else
    v_revalidar := true;
  end if;

  if v_revalidar and new.projeto_id is not null then
    if not exists (
      select 1 from public.projetos p
      where p.id = new.projeto_id and p.empreendimento_id = new.empreendimento_id
    ) then
      raise exception 'Projeto não pertence ao empreendimento.' using errcode = '23514';
    end if;
    if new.categoria_id is not null and not exists (
      select 1 from public.projeto_categorias_documento c
      where c.id = new.categoria_id and c.projeto_id = new.projeto_id
    ) then
      raise exception 'Categoria não pertence ao projeto.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

alter table public.documentos
  drop constraint documentos_equipamento_destino_check,
  drop constraint documentos_equipamento_par_check,
  drop constraint documentos_equipamento_papel_check,
  drop constraint documentos_equipamento_check,
  drop column equipamento_papel,
  drop column equipamento;

alter table public.pasta_regras
  drop constraint pasta_regras_equipamentos_destino_check,
  drop constraint pasta_regras_tipo_check,
  drop column tipo;

commit;
