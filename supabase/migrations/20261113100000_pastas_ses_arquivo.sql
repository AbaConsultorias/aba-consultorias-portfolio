-- Catálogo de pastas: SES, Estrutural da Elevatória, Básico da EEE e pastas de arquivo
-- (docs/PASTAS-SES-ARQUIVO-CONTRATO.md, aprovado em 12/11/2026).
-- 1. catalogo_pastas: tipo 'arquivo', coluna cria_regras, itens novos (SES, Básico da EEE, pastas de arquivo), PER/PEC/DT
--    passam a excluir SES e o Estrutural da Elevatória ganha modelo próprio (cópia do modelo do reservatório).
-- 2. pasta_regras.grupo aceita 'arquivo' e a coluna rotulo (obrigatória só com esse grupo).
-- 3. documentos.grupo aceita 'arquivo' e a coluna pasta_rotulo (obrigatória só com esse grupo);
--    confirmar_envio_conector copia o rótulo da regra para o documento.
-- 4. montar_empreendimento_de_pastas: item 'arquivo' vira regra de grupo oculta; item com cria_regras = false cria só o projeto.
-- Nenhuma política nem grant muda: o cliente continua lendo só documento liberado. Os modelos "... - SES" são buscados pelo
-- nome; se não existirem, o item nasce com modelo_id nulo e ativo = false (como no seed original).
-- Desfazer: supabase/reversoes/20261113100000_pastas_ses_arquivo.down.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. catalogo_pastas
-- ---------------------------------------------------------------------------

-- cria_regras = false só vale em item de projeto: o projeto nasce sem regra (Básico da EEE, que usa a pasta do SES).
-- arquivo: sem modelo, projeto, categoria, grupo, dependência nem destino; o rótulo do item é o nome do cartão do cliente.
alter table public.catalogo_pastas
  drop constraint catalogo_pastas_forma_check,
  drop constraint catalogo_pastas_tipo_check,
  add column cria_regras boolean not null default true,
  add constraint catalogo_pastas_tipo_check check (tipo in ('projeto', 'grupo', 'equipamentos', 'arquivo')),
  add constraint catalogo_pastas_forma_check check (
    (tipo = 'projeto' and nome_projeto is not null and grupo is null and destino_equipamentos is null)
    or (tipo = 'grupo' and grupo is not null and modelo_id is null and nome_projeto is null and categoria is null
        and depende_de is null and destino_equipamentos is null)
    or (tipo = 'equipamentos' and destino_equipamentos is not null and grupo is null and modelo_id is null
        and nome_projeto is null and categoria is null and depende_de is null)
    or (tipo = 'arquivo' and fase = 'base' and modelo_id is null and nome_projeto is null and categoria is null
        and grupo is null and depende_de is null and destino_equipamentos is null)
  ),
  add constraint catalogo_pastas_cria_regras_check check (cria_regras or tipo = 'projeto');

-- A pasta de PER/PEC/DT do lado SES tem item próprio (abaixo): os itens do lado SAA deixam de casar com ela.
update public.catalogo_pastas
set termos_excluir = case when 'SES' = any (termos_excluir) then termos_excluir else termos_excluir || array['SES']::text[] end
where chave in ('per', 'pec', 'dt');

-- Estrutural da Elevatória: modelo próprio, copiado do modelo que o catálogo aponta para o reservatório (etapas com marco e
-- categorias). Se já existe modelo com este nome, é reaproveitado como está.
do $$
declare
  v_origem uuid;
  v_novo uuid;
begin
  select m.id into v_novo from public.modelos_etapas m where m.nome = 'Projeto Estrutural da Elevatória';

  if v_novo is null then
    select c.modelo_id into v_origem from public.catalogo_pastas c where c.chave = 'estrutural_reservatorio';
    if v_origem is null then
      raise notice 'estrutural_reservatorio não tem modelo: estrutural_elevatoria continua como estava.';
      return;
    end if;

    insert into public.modelos_etapas (nome, descricao, ativo)
    select 'Projeto Estrutural da Elevatória', m.descricao, m.ativo
    from public.modelos_etapas m
    where m.id = v_origem
    returning id into v_novo;

    insert into public.modelo_etapas_itens (modelo_id, nome, ordem, marco)
    select v_novo, i.nome, i.ordem, i.marco
    from public.modelo_etapas_itens i
    where i.modelo_id = v_origem;

    insert into public.modelo_categorias_documento (modelo_id, nome, ordem)
    select v_novo, c.nome, c.ordem
    from public.modelo_categorias_documento c
    where c.modelo_id = v_origem;
  end if;

  update public.catalogo_pastas set modelo_id = v_novo where chave = 'estrutural_elevatoria';
end;
$$;

-- Itens novos. Os projetos "... - SES" dependem do SES (depende_de fixo, não 'sistema'): o nome do projeto é o do modelo,
-- sem sufixo. O Básico da EEE usa a pasta do SES e as mesmas palavras dele (a pasta casa com os dois itens). As pastas de
-- arquivo não viram projeto: os PDFs ficam guardados, ocultos, no bloco "Outros projetos" do cliente.
insert into public.catalogo_pastas
  (chave, rotulo, raiz, termos, termos_excluir, fase, tipo, modelo_id, nome_projeto, categoria, grupo, subpastas, depende_de,
   destino_equipamentos, ordem, ativo, cria_regras)
select v.chave, v.rotulo, v.raiz, v.termos, v.termos_excluir, v.fase, v.tipo, m.id, v.nome_projeto, v.categoria, null,
       v.subpastas::jsonb, v.depende_de, null, v.ordem, (v.tipo <> 'projeto' or m.id is not null), v.cria_regras
from (values
  ('per_ses', 'Projeto Elétrico Referência (PER) - SES', '03 - PRODUTOS', array['PER', 'SES']::text[], array['PEC']::text[],
    'complementar', 'projeto', 'Elevatória de Esgoto Bruto - PER - SES', 'Elevatória de Esgoto Bruto - PER - SES', 'Projetos',
    '[[["APROVAD*"]]]', 'ses', 45, true),
  ('pec_ses', 'Projeto Elétrico Construtivo (PEC) - SES', '03 - PRODUTOS', array['PEC', 'SES']::text[], array[]::text[],
    'complementar', 'projeto', 'Elevatória de Esgoto Bruto - PEC - SES', 'Elevatória de Esgoto Bruto - PEC - SES', 'Projetos',
    '[[["APROVAD*"]]]', 'ses', 55, true),
  ('dt_ses', 'Descrição Topográfica - SES', '03 - PRODUTOS', array['DESCRICAO', 'TOPOGRAFICA', 'SES']::text[], array[]::text[],
    'complementar', 'projeto', 'Descrição Topográfica Faixas de Servidão - SES', 'Descrição Topográfica Faixas de Servidão - SES', 'Projetos',
    '[[["APROVAD*"]]]', 'ses', 35, true),
  ('basico_ees', 'Básico da Elevatória de Esgoto - SES', '03 - PRODUTOS', array['SES']::text[],
    coalesce(
      (select c.termos_excluir from public.catalogo_pastas c where c.chave = 'ses'),
      array['PER', 'PEC', 'TERMO', 'ORDEM', 'SIMOS', 'LAUDOS', 'DOACAO', 'DESCRICAO', 'TOPOGRAFICA', 'ESTRUTURAL', 'CONSULTORIA']::text[]
    ),
    'complementar', 'projeto', 'Básico da Elevatória de Esgoto - SES', 'Básico da Elevatória de Esgoto - SES', null::text,
    '[]', 'ses', 25, false),
  ('urbanistico', 'Projeto Urbanístico', '03 - PRODUTOS', array['URBANISTICO']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 200, true),
  ('rede_aerea', 'Projeto de Rede Aérea', '03 - PRODUTOS', array['REDE', 'AEREA']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 210, true),
  ('telemetria', 'Projeto de Telemetria e Rádio', '03 - PRODUTOS', array['TELEMETRIA|RADIO']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 220, true),
  ('drenagem', 'Projeto de Drenagem Pluvial', '03 - PRODUTOS', array['DRENAGEM']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 230, true),
  ('terraplanagem', 'Projeto de Terraplanagem', '03 - PRODUTOS', array['TERRAPLANAGEM|TERRAPLENAGEM']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 240, true),
  ('motobomba', 'Conjunto Motobomba', '03 - PRODUTOS', array['MOTOBOMBA']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 250, true),
  ('executivos', 'Projetos Executivos', '03 - PRODUTOS', array['EXECUTIVO*']::text[], array[]::text[],
    'base', 'arquivo', null::text, null::text, null::text, '[]', null::text, 260, true)
) as v(chave, rotulo, raiz, termos, termos_excluir, fase, tipo, modelo_nome, nome_projeto, categoria, subpastas, depende_de, ordem, cria_regras)
left join public.modelos_etapas m on m.nome = v.modelo_nome;

-- ---------------------------------------------------------------------------
-- 2. pasta_regras: grupo 'arquivo' e rotulo
-- ---------------------------------------------------------------------------

-- rotulo é o nome do cartão no bloco "Outros projetos". "is not distinct from" porque, com grupo nulo (regra de projeto),
-- "grupo = 'arquivo'" seria nulo e o CHECK deixaria passar uma regra de projeto com rótulo.
alter table public.pasta_regras
  drop constraint pasta_regras_grupo_check,
  add column rotulo text,
  add constraint pasta_regras_grupo_check check (grupo in ('contratos', 'orcamentos', 'arquivo')),
  add constraint pasta_regras_rotulo_check check (
    rotulo is null or (char_length(btrim(rotulo)) between 1 and 120 and rotulo !~ '[\u0001-\u001f\u007f-\u009f]')
  ),
  add constraint pasta_regras_rotulo_grupo_check check ((grupo is not distinct from 'arquivo') = (rotulo is not null)),
  -- Pasta de arquivo nunca libera sozinha: os PDFs ficam ocultos até a equipe liberar.
  add constraint pasta_regras_arquivo_sem_liberacao_check check (grupo is distinct from 'arquivo' or not liberar_automatico);

-- ---------------------------------------------------------------------------
-- 3. documentos: grupo 'arquivo' e pasta_rotulo
-- ---------------------------------------------------------------------------

alter table public.documentos
  drop constraint documentos_grupo_check,
  add column pasta_rotulo text,
  add constraint documentos_grupo_check check (grupo in ('contratos', 'orcamentos', 'arquivo')),
  add constraint documentos_pasta_rotulo_check check (
    pasta_rotulo is null or (char_length(btrim(pasta_rotulo)) between 1 and 120 and pasta_rotulo !~ '[\u0001-\u001f\u007f-\u009f]')
  ),
  add constraint documentos_pasta_rotulo_grupo_check check ((grupo is not distinct from 'arquivo') = (pasta_rotulo is not null));

-- Mesma função de 20261112100000_etapas_automaticas.sql (assinatura, resultados e grants iguais). A única mudança: o
-- documento criado por regra recebe pasta_rotulo = rotulo da regra (só a regra de grupo 'arquivo' tem rótulo, pelo CHECK
-- de pasta_regras; nas demais é nulo).
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
      id, empreendimento_id, projeto_id, categoria_id, grupo, pasta_rotulo, titulo, storage_path, mime, tamanho, sha256,
      liberado_cliente, substitui_id, equipamento, equipamento_papel
    )
    values (
      v_envio.documento_planejado_id, v_envio.empreendimento_id, v_regra.projeto_id, v_categoria,
      v_regra.grupo, v_regra.rotulo, p_titulo, v_envio.storage_path, 'application/pdf', v_envio.tamanho, v_envio.sha256,
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
-- 4. montar_empreendimento_de_pastas
-- ---------------------------------------------------------------------------

-- Mesma função de 20261111100000_modelo_pastas.sql (assinatura, permissões, ordem de criação e grants iguais). Mudanças:
-- (a) item 'arquivo' não tem projeto: cada caminho vira uma regra comum com grupo 'arquivo' e rotulo = rótulo do catálogo,
--     oculta; (b) item com cria_regras = false cria ou reaproveita só o projeto e NUNCA insere regra (os caminhos recebidos
--     são descartados). O item que depende de 'ses' continua no bloco 2 da ordenação, depois do próprio SES.
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

    -- Item que não cria regras (projeto sem regra própria): o que vier em caminhos é descartado, não vira regra.
    if not v_cat.cria_regras then
      v_caminhos := '{}'::text[];
    end if;

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
      elsif v_cat.tipo = 'arquivo' then
        insert into public.pasta_regras (empreendimento_id, caminho_prefixo, tipo, projeto_id, categoria_id, grupo, rotulo, liberar_automatico, ativa)
        values (p_empreendimento, v_caminho, 'comum', null, null, 'arquivo', v_cat.rotulo, false, true);
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

commit;
