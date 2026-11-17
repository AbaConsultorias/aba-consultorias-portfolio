-- Desfaz supabase/migrations/20261112100000_etapas_automaticas.sql: devolve criar_projeto_de_modelo ao texto de
-- 20261110110000_ordem_projetos.sql e confirmar_envio_conector ao de 20261110100000_simos_laudos.sql, apaga as funções,
-- as tabelas etapa_sinais e projeto_etapa_historico, e tira as colunas e restrições novas.
-- O código que usa as etapas automáticas (rotas, telas, regras de Protocolos e Devolutivas) precisa voltar junto.
-- Rode à mão, com o usuário postgres.
-- Perda de dados: as regras dos tipos 'protocolos' e 'devolutivas' são apagadas (os documentos já recebidos ficam, como
-- documentos comuns), e sinais, histórico de etapas, marcos das etapas, sinal das regras e modo das etapas são descartados.
-- As etapas atuais dos projetos e as datas de conclusão preenchidas pelas mudanças ficam como estão.

begin;

-- Gatilho do sinal padrão e marcos na tela Modelos: volta ao texto de 20261106120000_etapa8_rls_andamento_obras.sql.
drop trigger pasta_regras_sinal_padrao on public.pasta_regras;
drop function public.sinal_padrao_da_regra();

create or replace function public.salvar_modelo_portal(p_id uuid, p_nome text, p_descricao text, p_ativo boolean, p_etapas jsonb, p_categorias jsonb)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v_id uuid := p_id; v jsonb;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if p_nome is null or length(btrim(p_nome)) not between 2 and 160 or length(p_descricao) > 5000 or p_ativo is null then raise exception 'Modelo inválido.' using errcode = '22023'; end if;
  perform public.validar_lista_portal(p_etapas, true, false);
  perform public.validar_lista_portal(p_categorias, false, false);
  if v_id is null then
    insert into public.modelos_etapas (nome,descricao,ativo) values (btrim(p_nome),p_descricao,p_ativo) returning id into v_id;
  else
    perform 1 from public.modelos_etapas where id = v_id for update;
    if not found then raise exception 'Modelo indisponível.' using errcode = 'P0002'; end if;
    update public.modelos_etapas set nome=btrim(p_nome),descricao=p_descricao,ativo=p_ativo where id=v_id;
  end if;
  if exists (select 1 from jsonb_array_elements(p_etapas) v where v ? 'id' and not exists (select 1 from public.modelo_etapas_itens where id=(v->>'id')::uuid and modelo_id=v_id))
    or exists (select 1 from jsonb_array_elements(p_categorias) v where v ? 'id' and not exists (select 1 from public.modelo_categorias_documento where id=(v->>'id')::uuid and modelo_id=v_id)) then
    raise exception 'ID não pertence ao modelo.' using errcode = '23514';
  end if;
  delete from public.modelo_etapas_itens where modelo_id=v_id and id not in (select (v->>'id')::uuid from jsonb_array_elements(p_etapas) v where v ? 'id');
  delete from public.modelo_categorias_documento where modelo_id=v_id and id not in (select (v->>'id')::uuid from jsonb_array_elements(p_categorias) v where v ? 'id');
  for v in select value from jsonb_array_elements(p_etapas) loop
    if v ? 'id' then update public.modelo_etapas_itens set nome=btrim(v->>'nome'),ordem=(v->>'ordem')::int where id=(v->>'id')::uuid;
    else insert into public.modelo_etapas_itens (modelo_id,nome,ordem) values (v_id,btrim(v->>'nome'),(v->>'ordem')::int); end if;
  end loop;
  for v in select value from jsonb_array_elements(p_categorias) loop
    if v ? 'id' then update public.modelo_categorias_documento set nome=btrim(v->>'nome'),ordem=(v->>'ordem')::int where id=(v->>'id')::uuid;
    else insert into public.modelo_categorias_documento (modelo_id,nome,ordem) values (v_id,btrim(v->>'nome'),(v->>'ordem')::int); end if;
  end loop;
  return v_id;
end $function$;

create or replace function public.validar_lista_portal(p_lista jsonb, p_etapas boolean, p_projeto boolean)
 returns void
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v jsonb; d date;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' then raise exception 'Lista inválida.' using errcode = '22023'; end if;
  if jsonb_array_length(p_lista) > 100 then raise exception 'Lista excede 100 itens.' using errcode = '22023'; end if;
  for v in select value from jsonb_array_elements(p_lista) loop
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'nome') is distinct from 'string'
      or length(btrim(v->>'nome')) not between 2 and 160 or jsonb_typeof(v->'ordem') is distinct from 'number'
      or (v->>'ordem') !~ '^[0-9]+$' or (v->>'ordem')::numeric > 2147483647
      or exists (select 1 from jsonb_object_keys(v) k where k not in ('id','nome','ordem','concluidaEm'))
      or (v ? 'concluidaEm' and not (p_etapas and p_projeto)) then
      raise exception 'Item inválido.' using errcode = '22023';
    end if;
    if v ? 'id' then
      if jsonb_typeof(v->'id') is distinct from 'string' or (v->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ID inválido.' using errcode = '22023'; end if;
    end if;
    if v ? 'concluidaEm' and v->'concluidaEm' <> 'null'::jsonb then
      if jsonb_typeof(v->'concluidaEm') <> 'string' or (v->>'concluidaEm') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Data inválida.' using errcode = '22023'; end if;
      d := (v->>'concluidaEm')::date;
      if to_char(d, 'YYYY-MM-DD') <> v->>'concluidaEm' then raise exception 'Data inválida.' using errcode = '22023'; end if;
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_lista) v where v ? 'id' group by (v->>'id')::uuid having count(*) > 1)
    or (p_etapas and exists (select 1 from jsonb_array_elements(p_lista) v group by (v->>'ordem')::int having count(*) > 1))
    or (not p_etapas and exists (select 1 from jsonb_array_elements(p_lista) v group by btrim(v->>'nome') having count(*) > 1)) then
    raise exception 'Lista com duplicatas.' using errcode = '22023';
  end if;
end $function$;

create or replace function public.criar_projeto_de_modelo(p_empreendimento uuid, p_modelo uuid, p_nome text, p_projeto_pai uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
declare
  v_projeto uuid;
  v_primeira_etapa uuid;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Apenas a equipe pode criar projetos.' using errcode = 'insufficient_privilege';
  end if;

  if p_modelo is null then
    raise exception 'O modelo do projeto é obrigatório.' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.projetos (empreendimento_id, modelo_origem_id, nome, projeto_pai_id, ordem)
  values (
    p_empreendimento, p_modelo, p_nome, p_projeto_pai,
    coalesce((
      select max(i.ordem) from public.projetos i
      where i.empreendimento_id = p_empreendimento and i.projeto_pai_id is not distinct from p_projeto_pai
    ), -1) + 1
  )
  returning id into v_projeto;

  insert into public.projeto_etapas (projeto_id, nome, ordem)
  select v_projeto, i.nome, i.ordem
  from public.modelo_etapas_itens i
  where i.modelo_id = p_modelo;

  insert into public.projeto_categorias_documento (projeto_id, nome, ordem)
  select v_projeto, c.nome, c.ordem
  from public.modelo_categorias_documento c
  where c.modelo_id = p_modelo;

  select e.id into v_primeira_etapa
  from public.projeto_etapas e
  where e.projeto_id = v_projeto
  order by e.ordem
  limit 1;

  update public.projetos
  set etapa_atual_id = v_primeira_etapa
  where id = v_projeto;

  return v_projeto;
end;
$function$;

create or replace function public.confirmar_envio_conector(
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

drop function public.aplicar_sugestoes_empreendimento(uuid, uuid[], uuid[]);
drop function public.desfazer_etapa(uuid);
drop function public.ignorar_sinal_etapa(uuid);
drop function public.aplicar_sugestao_etapa(uuid, uuid, text);
drop function public.etapa_aplicar_sinal_interno(uuid, uuid, text);
drop function public.sugestao_etapa(uuid);
drop function public.etapa_sugestao_calcular(uuid);

drop trigger projetos_registrar_historico_etapa on public.projetos;
drop function public.registrar_historico_etapa();
drop table public.projeto_etapa_historico;
drop table public.etapa_sinais;

drop trigger empreendimentos_proteger_modo_etapas on public.empreendimentos;
drop function public.proteger_modo_etapas_empreendimento();
alter table public.empreendimentos
  drop constraint empreendimentos_etapas_modo_check,
  drop column etapas_modo;

delete from public.pasta_regras where tipo in ('protocolos', 'devolutivas');

alter table public.pasta_regras
  drop constraint pasta_regras_sinal_check,
  drop constraint pasta_regras_etapas_destino_check,
  drop constraint pasta_regras_sinal_valor_check,
  drop constraint pasta_regras_tipo_check,
  drop column sinal,
  add constraint pasta_regras_tipo_check check (tipo in ('comum', 'equipamentos'));

drop index public.projeto_etapas_marco_idx;
drop index public.modelo_etapas_itens_marco_idx;

alter table public.projeto_etapas
  drop constraint projeto_etapas_marco_check,
  drop column marco;

alter table public.modelo_etapas_itens
  drop constraint modelo_etapas_itens_marco_check,
  drop column marco;

drop function public.marco_da_etapa_por_nome(text);

commit;
