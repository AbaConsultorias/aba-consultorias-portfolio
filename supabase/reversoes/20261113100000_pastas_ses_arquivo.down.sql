-- Desfaz supabase/migrations/20261113100000_pastas_ses_arquivo.sql: devolve confirmar_envio_conector ao texto de
-- 20261112100000_etapas_automaticas.sql e montar_empreendimento_de_pastas ao de 20261111100000_modelo_pastas.sql, tira as
-- colunas e restrições novas e apaga os itens novos do catálogo.
-- O código que usa o grupo 'arquivo' e o item sem regras (montagem, regras de pasta, documentos do cliente e do admin) precisa
-- voltar junto. Rode à mão, com o usuário postgres.
-- Falha de propósito, sem apagar nada, se ainda existir regra ou documento do grupo 'arquivo': apague-os (ou mude o grupo) antes.
-- Perda de dado: os itens novos do catálogo e as edições feitas neles; PER, PEC e Descrição Topográfica voltam a casar
-- pastas "SES". Projetos já criados pela montagem ficam (são projetos comuns).
-- O modelo "Projeto Estrutural da Elevatória" só é apagado se nenhum projeto o usa e se continua igual ao do reservatório;
-- senão ele fica, e o item estrutural_elevatoria volta a apontar para o modelo do reservatório.

begin;

do $$
declare
  v_regras bigint;
  v_documentos bigint;
begin
  select count(*) into v_regras from public.pasta_regras where grupo = 'arquivo' or rotulo is not null;
  select count(*) into v_documentos from public.documentos where grupo = 'arquivo' or pasta_rotulo is not null;
  if v_regras > 0 or v_documentos > 0 then
    raise exception 'Ainda existem % regra(s) e % documento(s) do grupo "arquivo" (Outros projetos). Apague ou mude o grupo deles antes de desfazer esta migration.', v_regras, v_documentos;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- montar_empreendimento_de_pastas: texto de 20261111100000_modelo_pastas.sql
-- ---------------------------------------------------------------------------

create or replace function public.montar_empreendimento_de_pastas(p_empreendimento uuid, p_itens jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_codigo text;
  v_ler_complementares boolean;
  v_lista jsonb;
  v_pastas text[];
  v_item jsonb;
  v_cat public.catalogo_pastas%rowtype;
  v_cat_ref public.catalogo_pastas%rowtype;
  v_chave text;
  v_pai_chave text;
  v_nome text;
  v_caminhos text[];
  v_caminho text;
  v_limite integer;
  v_projeto uuid;
  v_pai uuid;
  v_destino uuid;
  v_categoria uuid;
  v_existente_id uuid;
  v_existente_modelo uuid;
  v_mapa jsonb := '{}'::jsonb;
  v_criados integer := 0;
  v_reaproveitados integer := 0;
  v_regras integer := 0;
  v_ignorados jsonb := '[]'::jsonb;
begin
  if not (select public.tem_permissao('empreendimentos.editar'))
    or not (select public.tem_permissao('servidor.regras')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_empreendimento is null or p_itens is null or jsonb_typeof(p_itens) <> 'array'
    or jsonb_array_length(p_itens) not between 1 and 50 then
    raise exception 'A lista de itens é inválida.' using errcode = 'P0001';
  end if;

  -- Forma de cada item, antes de qualquer escrita.
  for v_item in select e.value from jsonb_array_elements(p_itens) as e loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item -> 'chave') is distinct from 'string'
      or jsonb_typeof(v_item -> 'caminhos') is distinct from 'array'
      or coalesce(jsonb_typeof(v_item -> 'nome_projeto'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(v_item -> 'projeto_pai_chave'), 'null') not in ('string', 'null') then
      raise exception 'A lista de itens é inválida.' using errcode = 'P0001';
    end if;
    -- Separado do teste acima: o SQL não garante a ordem de avaliação, e estas funções falham em valor de outra forma.
    if jsonb_array_length(v_item -> 'caminhos') > 10
      or exists (select 1 from jsonb_array_elements(v_item -> 'caminhos') as c where jsonb_typeof(c.value) <> 'string') then
      raise exception 'A lista de itens é inválida.' using errcode = 'P0001';
    end if;
  end loop;

  -- Trava o empreendimento: duas montagens ao mesmo tempo não duplicam nada.
  select e.codigo_pasta, e.ler_complementares into v_codigo, v_ler_complementares
  from public.empreendimentos e
  where e.id = p_empreendimento
  for update;

  if not found then
    raise exception 'Empreendimento não encontrado.' using errcode = 'P0001';
  end if;
  if v_codigo is null then
    raise exception 'O empreendimento não tem código de pasta.' using errcode = 'P0001';
  end if;

  select c.arvore -> v_codigo into v_lista
  from public.conectores c
  where c.revogado_em is null
  limit 1;

  if v_lista is null or jsonb_typeof(v_lista) <> 'array' then
    raise exception 'O programa do servidor ainda não informou as pastas deste empreendimento.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(normalize(x.valor, nfc)), '{}'::text[]) into v_pastas
  from jsonb_array_elements_text(v_lista) as x(valor);

  for v_item in
    select e.item
    from jsonb_array_elements(p_itens) with ordinality as e(item, posicao)
    left join public.catalogo_pastas c on c.chave = e.item ->> 'chave'
    order by
      case
        when c.chave = 'saa' then 1
        when c.chave = 'ses' then 2
        when e.item ->> 'projeto_pai_chave' = 'saa' then 1
        when e.item ->> 'projeto_pai_chave' = 'ses' then 2
        else 3
      end,
      case when c.chave in ('saa', 'ses') then 0 else 1 end,
      c.ordem,
      e.posicao
  loop
    v_chave := v_item ->> 'chave';
    v_pai_chave := v_item ->> 'projeto_pai_chave';

    select * into v_cat from public.catalogo_pastas c where c.chave = v_chave and c.ativo;
    if not found then
      raise exception 'O item "%" não existe ou está desativado no catálogo.', left(v_chave, 40) using errcode = 'P0001';
    end if;
    if v_cat.fase = 'complementar' and not v_ler_complementares then
      raise exception 'Ligue "Ler projetos complementares" antes de criar "%".', v_cat.rotulo using errcode = 'P0001';
    end if;

    -- Caminhos: NFC, existentes na árvore do conector (a pasta em si ou uma pasta acima de outra listada) e no máximo
    -- um por subpasta-padrão do item (uma só, quando o item usa a própria pasta).
    select coalesce(array_agg(distinct c.valor), '{}'::text[]) into v_caminhos
    from jsonb_array_elements_text(v_item -> 'caminhos') as c(valor);

    v_limite := greatest(jsonb_array_length(v_cat.subpastas), 1);
    if cardinality(v_caminhos) > v_limite then
      raise exception 'O item "%" aceita no máximo % pasta(s).', v_cat.rotulo, v_limite using errcode = 'P0001';
    end if;

    foreach v_caminho in array v_caminhos loop
      if v_caminho is not nfc normalized
        or not public.caminho_relativo_valido(v_caminho)
        or char_length(v_caminho) > 500
        or position(chr(92) in v_caminho) > 0 then
        raise exception 'Caminho de pasta inválido para "%".', v_cat.rotulo using errcode = 'P0001';
      end if;
      if not exists (
        select 1 from unnest(v_pastas) as p(pasta)
        where p.pasta = v_caminho or left(p.pasta, char_length(v_caminho) + 1) = v_caminho || '/'
      ) then
        raise exception 'A pasta não está mais na lista do servidor: %', left(v_caminho, 200) using errcode = 'P0001';
      end if;
    end loop;

    v_projeto := null;

    if v_cat.tipo = 'projeto' then
      v_nome := btrim(v_item ->> 'nome_projeto');
      if v_nome is null or char_length(v_nome) not between 1 and 160 or v_nome ~ '[\u0001-\u001f\u007f-\u009f]' then
        raise exception 'O nome do projeto de "%" é inválido.', v_cat.rotulo using errcode = 'P0001';
      end if;
      if v_cat.modelo_id is null then
        raise exception 'O item "%" ainda não tem modelo de projeto no catálogo.', v_cat.rotulo using errcode = 'P0001';
      end if;

      select p.id, p.modelo_origem_id into v_existente_id, v_existente_modelo
      from public.projetos p
      where p.empreendimento_id = p_empreendimento and p.nome = v_nome;

      if v_existente_id is not null then
        if v_existente_modelo is distinct from v_cat.modelo_id then
          raise exception 'Já existe um projeto chamado "%" que não é deste modelo.', v_nome using errcode = 'P0001';
        end if;
        v_projeto := v_existente_id;
        v_reaproveitados := v_reaproveitados + 1;
      else
        v_pai := null;
        if v_pai_chave is not null then
          if v_pai_chave = v_chave then
            raise exception 'Um projeto não pode depender de si mesmo.' using errcode = 'P0001';
          end if;
          select * into v_cat_ref from public.catalogo_pastas c where c.chave = v_pai_chave and c.tipo = 'projeto';
          if not found then
            raise exception 'O projeto "%" depende de um item que não existe no catálogo.', v_cat.rotulo using errcode = 'P0001';
          end if;
          if v_mapa ? v_pai_chave then
            v_pai := (v_mapa ->> v_pai_chave)::uuid;
          else
            select p.id into v_pai
            from public.projetos p
            where p.empreendimento_id = p_empreendimento and p.modelo_origem_id = v_cat_ref.modelo_id
            order by p.ordem, p.nome, p.id
            limit 1;
          end if;
          if v_pai is null then
            raise exception 'O projeto "%" precisa do projeto "%", que não existe neste empreendimento.', v_cat.rotulo, v_cat_ref.rotulo using errcode = 'P0001';
          end if;
        end if;

        v_projeto := public.criar_projeto_de_modelo(p_empreendimento, v_cat.modelo_id, v_nome, v_pai);
        v_criados := v_criados + 1;
      end if;

      -- O primeiro projeto de cada chave serve de destino para quem depende dela (SIMOS usa o da Ordem de Serviço).
      if not (v_mapa ? v_chave) then
        v_mapa := v_mapa || jsonb_build_object(v_chave, v_projeto);
      end if;
    end if;

    if v_cat.tipo = 'equipamentos' then
      select * into v_cat_ref from public.catalogo_pastas c where c.chave = v_cat.destino_equipamentos and c.tipo = 'projeto';
      if not found then
        raise exception 'O destino de "%" não existe no catálogo.', v_cat.rotulo using errcode = 'P0001';
      end if;
      if v_mapa ? v_cat.destino_equipamentos then
        v_destino := (v_mapa ->> v_cat.destino_equipamentos)::uuid;
      else
        select p.id into v_destino
        from public.projetos p
        where p.empreendimento_id = p_empreendimento and p.modelo_origem_id = v_cat_ref.modelo_id
        order by p.ordem, p.nome, p.id
        limit 1;
      end if;
      if v_destino is null then
        raise exception '"%" precisa do projeto "%", que não existe neste empreendimento.', v_cat.rotulo, v_cat_ref.rotulo using errcode = 'P0001';
      end if;
    end if;

    foreach v_caminho in array v_caminhos loop
      if exists (
        select 1 from public.pasta_regras r
        where r.empreendimento_id = p_empreendimento and lower(r.caminho_prefixo) = lower(v_caminho)
      ) then
        v_ignorados := v_ignorados || jsonb_build_object('chave', v_chave, 'caminho', v_caminho, 'motivo', 'regra existente');
        continue;
      end if;

      if v_cat.tipo = 'projeto' then
        v_categoria := null;
        if v_cat.categoria is not null then
          select c.id into v_categoria
          from public.projeto_categorias_documento c
          where c.projeto_id = v_projeto and lower(btrim(c.nome)) = lower(btrim(v_cat.categoria))
          order by c.ordem, c.id
          limit 1;
        end if;
        insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id, categoria_id, grupo, liberar_automatico, ativa)
        values (p_empreendimento, v_caminho, 'comum', v_projeto, v_categoria, null, false, true);
      elsif v_cat.tipo = 'grupo' then
        insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id, categoria_id, grupo, liberar_automatico, ativa)
        values (p_empreendimento, v_caminho, 'comum', null, null, v_cat.grupo, false, true);
      else
        insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id, categoria_id, grupo, liberar_automatico, ativa)
        values (p_empreendimento, v_caminho, 'equipamentos', v_destino, null, null, false, true);
      end if;
      v_regras := v_regras + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'projetos_criados', v_criados,
    'projetos_reaproveitados', v_reaproveitados,
    'regras_criadas', v_regras,
    'ignorados', v_ignorados
  );
end;
$$;

revoke execute on function public.montar_empreendimento_de_pastas(uuid, jsonb) from public, anon;
grant execute on function public.montar_empreendimento_de_pastas(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- confirmar_envio_conector: texto de 20261112100000_etapas_automaticas.sql
-- ---------------------------------------------------------------------------

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
  v_sinal uuid;
  v_modo text;
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

  -- Regra que marca etapa: trava o projeto ANTES de inserir documento e sinal. As FKs desses inserts seguram KEY SHARE
  -- no projeto; travar depois (no automático) faria duas confirmações do mesmo projeto se travarem uma à outra.
  if v_regra.sinal is not null and v_regra.projeto_id is not null then
    perform 1 from public.projetos p where p.id = v_regra.projeto_id for update;
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

  if v_regra.sinal is not null and v_regra.projeto_id is not null then
    begin
      insert into public.etapa_sinais (empreendimento_id, projeto_id, documento_id, tipo, data_arquivo)
      values (
        v_envio.empreendimento_id, v_regra.projeto_id, v_envio.documento_planejado_id, v_regra.sinal,
        coalesce(v_envio.mtime, v_envio.em)
      )
      returning id into v_sinal;
    exception when others then
      v_sinal := null;
      raise warning 'Sinal de etapa não registrado (erro %).', sqlstate;
    end;

    -- No automático aplica a sugestão ATUAL do projeto (não só a deste arquivo): se uma confirmação anterior falhou ao
    -- aplicar, esta põe a etapa em dia. O modo é conferido de novo, com trava, dentro de etapa_aplicar_sinal_interno.
    if v_sinal is not null then
      select e.etapas_modo into v_modo from public.empreendimentos e where e.id = v_envio.empreendimento_id;
      if v_modo = 'automatico' then
        begin
          select s.sinal_id into v_sinal from public.etapa_sugestao_calcular(v_regra.projeto_id) s;
          if v_sinal is not null then
            perform public.etapa_aplicar_sinal_interno(v_regra.projeto_id, v_sinal, 'automatico');
          end if;
        exception when others then
          raise warning 'Etapa automática não aplicada (erro %).', sqlstate;
        end;
      end if;
    end if;
  end if;

  return jsonb_build_object('situacao', 'confirmado', 'documento_id', v_envio.documento_planejado_id, 'novo', true);
end;
$$;

revoke execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.confirmar_envio_conector(uuid, uuid, text, uuid, timestamptz, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- documentos e pasta_regras
-- ---------------------------------------------------------------------------

alter table public.documentos
  drop constraint documentos_pasta_rotulo_grupo_check,
  drop constraint documentos_pasta_rotulo_check,
  drop constraint documentos_grupo_check,
  drop column pasta_rotulo,
  add constraint documentos_grupo_check check (grupo in ('contratos', 'orcamentos'));

alter table public.pasta_regras
  drop constraint pasta_regras_arquivo_sem_liberacao_check,
  drop constraint pasta_regras_rotulo_grupo_check,
  drop constraint pasta_regras_rotulo_check,
  drop constraint pasta_regras_grupo_check,
  drop column rotulo,
  add constraint pasta_regras_grupo_check check (grupo in ('contratos', 'orcamentos'));

-- ---------------------------------------------------------------------------
-- catalogo_pastas
-- ---------------------------------------------------------------------------

-- Itens novos (e qualquer outro de tipo arquivo ou sem regras, que sem a coluna passariam a criar regra).
delete from public.catalogo_pastas
where tipo = 'arquivo'
   or not cria_regras
   or chave in ('per_ses', 'pec_ses', 'dt_ses', 'basico_ees', 'urbanistico', 'rede_aerea', 'telemetria', 'drenagem',
                'terraplanagem', 'motobomba', 'executivos');

update public.catalogo_pastas
set termos_excluir = array_remove(termos_excluir, 'SES')
where chave in ('per', 'pec', 'dt');

-- Estrutural da Elevatória volta ao modelo do reservatório; o modelo criado pela migration sai se ninguém o usa e se ainda
-- é uma cópia fiel (mesmas etapas, marcos e categorias).
do $$
declare
  v_novo uuid;
  v_origem uuid;
begin
  select m.id into v_novo from public.modelos_etapas m where m.nome = 'Projeto Estrutural da Elevatória';
  select c.modelo_id into v_origem from public.catalogo_pastas c where c.chave = 'estrutural_reservatorio';

  if v_novo is null or v_origem is null or v_novo = v_origem then
    return;
  end if;

  update public.catalogo_pastas set modelo_id = v_origem where chave = 'estrutural_elevatoria' and modelo_id = v_novo;

  if exists (select 1 from public.projetos p where p.modelo_origem_id = v_novo)
    or exists (select 1 from public.catalogo_pastas c where c.modelo_id = v_novo) then
    raise notice 'O modelo "Projeto Estrutural da Elevatória" tem projetos ou itens do catálogo e foi mantido.';
    return;
  end if;

  if exists (
       (select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i where i.modelo_id = v_novo
        except select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i where i.modelo_id = v_origem)
       union all
       (select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i where i.modelo_id = v_origem
        except select i.nome, i.ordem, i.marco from public.modelo_etapas_itens i where i.modelo_id = v_novo)
       union all
       (select c.nome, c.ordem, null from public.modelo_categorias_documento c where c.modelo_id = v_novo
        except select c.nome, c.ordem, null from public.modelo_categorias_documento c where c.modelo_id = v_origem)
       union all
       (select c.nome, c.ordem, null from public.modelo_categorias_documento c where c.modelo_id = v_origem
        except select c.nome, c.ordem, null from public.modelo_categorias_documento c where c.modelo_id = v_novo)
     ) then
    raise notice 'O modelo "Projeto Estrutural da Elevatória" foi editado depois da cópia e foi mantido.';
    return;
  end if;

  -- Nunca apaga: o modelo pode ter existido antes da migration ou ter sido editado em campos não comparados acima.
  raise notice 'O modelo "Projeto Estrutural da Elevatória" foi mantido; apague-o pela tela Modelos se não for usado.';
end;
$$;

alter table public.catalogo_pastas
  drop constraint catalogo_pastas_cria_regras_check,
  drop constraint catalogo_pastas_forma_check,
  drop constraint catalogo_pastas_tipo_check,
  drop column cria_regras,
  add constraint catalogo_pastas_tipo_check check (tipo in ('projeto', 'grupo', 'equipamentos')),
  add constraint catalogo_pastas_forma_check check (
    (tipo = 'projeto' and nome_projeto is not null and grupo is null and destino_equipamentos is null)
    or (tipo = 'grupo' and grupo is not null and modelo_id is null and nome_projeto is null and categoria is null
        and depende_de is null and destino_equipamentos is null)
    or (tipo = 'equipamentos' and destino_equipamentos is not null and grupo is null and modelo_id is null
        and nome_projeto is null and categoria is null and depende_de is null)
  );

commit;
