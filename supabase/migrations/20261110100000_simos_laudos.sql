-- SIMOS e Laudos por equipamento (docs/SIMOS-LAUDOS-CONTRATO.md, aprovado pelo dono em 09/11/2026).
-- 1. pasta_regras.tipo: 'comum' (como sempre) ou 'equipamentos'. A regra 'equipamentos' aponta a pasta que tem uma
--    subpasta por equipamento e exige um projeto com as categorias SIMOS e Laudos.
-- 2. documentos.equipamento e documentos.equipamento_papel: preenchidos só nos documentos dessa regra.
-- 3. confirmar_envio_conector ganha p_equipamento e p_papel: para regra 'equipamentos' a categoria é buscada aqui,
--    no banco, pelo papel; o chamador nunca escolhe a categoria.
-- Aditiva: nada existente muda de comportamento. Nenhuma política de RLS é criada, alterada ou removida: o
-- cliente continua lendo só documento liberado do próprio empreendimento (a exceção do SIMO, que o cliente só
-- visualiza e não baixa, é da rota, não do banco).
-- Desfazer: supabase/reversoes/20261110100000_simos_laudos.down.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. pasta_regras.tipo
-- ---------------------------------------------------------------------------

alter table public.pasta_regras
  add column tipo text not null default 'comum',
  add constraint pasta_regras_tipo_check check (tipo in ('comum', 'equipamentos')),
  add constraint pasta_regras_equipamentos_destino_check check (
    tipo <> 'equipamentos' or (projeto_id is not null and categoria_id is null and grupo is null)
  );

-- Mesma função de antes (projeto do empreendimento, categoria do projeto), mais: a regra 'equipamentos' só vale
-- num projeto que tenha as categorias SIMOS e Laudos (sem diferenciar caixa). Revalida quando o tipo ou o projeto
-- muda; apagar uma categoria depois não passa por aqui (a regra deixa de funcionar e o conector recusa o envio).
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

  if new.tipo = 'equipamentos' and new.projeto_id is not null
     and (tg_op = 'INSERT' or new.tipo is distinct from old.tipo or new.projeto_id is distinct from old.projeto_id) then
    if (
      select count(distinct lower(btrim(c.nome)))
        from public.projeto_categorias_documento c
       where c.projeto_id = new.projeto_id and lower(btrim(c.nome)) in ('simos', 'laudos')
    ) <> 2 then
      raise exception 'O projeto precisa ter as categorias SIMOS e Laudos.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. documentos.equipamento e documentos.equipamento_papel
-- ---------------------------------------------------------------------------

-- Os dois nulos (documento comum) ou os dois preenchidos. Preenchidos exigem projeto e categoria: o SIMO e o
-- Laudo sempre moram numa categoria do projeto da regra. Consequência: apagar o projeto ou a categoria de um
-- SIMO/Laudo é recusado pelo banco (a FK tentaria zerar o vínculo); apague os documentos antes.
alter table public.documentos
  add column equipamento text,
  add column equipamento_papel text,
  add constraint documentos_equipamento_check check (
    equipamento is null
    or (char_length(equipamento) between 1 and 160 and equipamento !~ '[\u0001-\u001f\u007f-\u009f]')
  ),
  add constraint documentos_equipamento_papel_check check (equipamento_papel in ('simo', 'laudo')),
  add constraint documentos_equipamento_par_check check ((equipamento is null) = (equipamento_papel is null)),
  add constraint documentos_equipamento_destino_check check (
    equipamento is null or (projeto_id is not null and categoria_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. confirmar_envio_conector com equipamento e papel
-- ---------------------------------------------------------------------------

-- A API classifica o caminho (src/lib/conector/equipamentos.ts) e passa o equipamento e o papel; o banco decide o
-- resto: a regra 'equipamentos' exige os dois (papel 'simo' ou 'laudo') e a regra 'comum' exige os dois nulos,
-- senão é erro de programação (23514). A categoria é a 'SIMOS' ou 'Laudos' do projeto da regra, buscada aqui.
-- Revisão: se o documento substituído é de equipamento, o novo herda o nome do equipamento dele (a pasta pode ter
-- mudado de caixa) e o papel tem de ser o mesmo; papel diferente não é revisão e vale como sem anterior.
-- Situações novas: {"situacao": "sem_categoria"}  o projeto da regra não tem mais a categoria do papel.
-- As demais são as de 20261104110000_etapa7_conector_atomico.sql.
drop function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz);

create function public.confirmar_envio_conector(
  p_envio uuid,
  p_conector uuid,
  p_titulo text,
  p_substitui uuid,
  p_agora timestamptz,
  p_equipamento text,
  p_papel text
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
  v_categoria uuid := null;
  v_equipamento text := p_equipamento;
  v_papel text := p_papel;
  v_anterior_equipamento text;
  v_anterior_papel text;
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

  if v_regra.tipo = 'equipamentos' then
    if coalesce(v_papel, '') not in ('simo', 'laudo') or v_equipamento is null then
      raise exception 'Regra de equipamentos exige equipamento e papel.' using errcode = '23514';
    end if;
    select c.id into v_categoria
      from public.projeto_categorias_documento c
     where c.projeto_id = v_regra.projeto_id
       and lower(btrim(c.nome)) = case v_papel when 'simo' then 'simos' else 'laudos' end
     order by c.ordem, c.id
     limit 1;
    if v_categoria is null then
      return jsonb_build_object('situacao', 'sem_categoria');
    end if;
  else
    if v_papel is not null or v_equipamento is not null then
      raise exception 'Regra comum não tem equipamento nem papel.' using errcode = '23514';
    end if;
    v_categoria := v_regra.categoria_id;
  end if;

  if v_substitui is not null then
    select d.equipamento, d.equipamento_papel
      into v_anterior_equipamento, v_anterior_papel
      from public.documentos d
     where d.id = v_substitui and d.empreendimento_id = v_envio.empreendimento_id;

    if not found then
      v_substitui := null;
    elsif v_anterior_papel is not null then
      if v_anterior_papel is distinct from v_papel then
        v_substitui := null;
      else
        v_equipamento := v_anterior_equipamento;
      end if;
    elsif v_papel is not null then
      v_substitui := null;
    end if;
  end if;

  -- Bloco com tratamento de erro = subtransação: se o índice único (empreendimento_id, sha256) confirmado
  -- acusar a corrida, o documento e a origem inseridos acima dele são desfeitos junto.
  begin
    insert into public.documentos (
      id, empreendimento_id, projeto_id, categoria_id, grupo, titulo, storage_path, mime, tamanho, sha256,
      liberado_cliente, substitui_id, equipamento, equipamento_papel
    )
    values (
      v_envio.documento_planejado_id, v_envio.empreendimento_id, v_regra.projeto_id, v_categoria,
      v_regra.grupo, p_titulo, v_envio.storage_path, 'application/pdf', v_envio.tamanho, v_envio.sha256,
      false, v_substitui, v_equipamento, v_papel
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

revoke execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)
  to service_role;

commit;
