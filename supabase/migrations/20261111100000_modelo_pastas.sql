-- Montar projetos e regras a partir das pastas do servidor (docs/MODELO-PASTAS-CONTRATO.md, aprovado em 10/11/2026).
-- 1. catalogo_pastas: o que procurar em cada pasta do servidor (palavras-chave, modelo, subpasta, fase). Só o admin edita.
--    Nada de expressão regular vindo do banco: só listas de termos (o código do site compara palavra por palavra).
-- 2. empreendimentos.ler_complementares: chave "Ler projetos complementares" (padrão desligada).
-- 3. montar_empreendimento_de_pastas: cria os projetos, a hierarquia e as regras ocultas de uma vez (tudo ou nada).
--    Security invoker de propósito: roda com a permissão de quem clicou, então o RLS e os triggers valem.
-- Aditiva: nenhuma política existente muda. Seed do catálogo: o modelo é buscado pelo nome; se o modelo não existir (ou
-- o nome divergir), o item nasce com modelo_id nulo e ativo = false, e o admin liga depois de apontar o modelo.
-- Desfazer: supabase/reversoes/20261111100000_modelo_pastas.down.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. Validações do catálogo
-- ---------------------------------------------------------------------------

-- Termo = uma palavra sem acento em maiúsculas (A-Z, 0-9). "!" na frente exclui; "*" no fim vale como prefixo
-- (APROVAD* casa APROVADO e APROVADA). A expressão abaixo é fixa: o banco nunca executa padrão vindo de dado.
create function public.catalogo_termos_validos(p_termos text[], p_minimo integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_termos is not null
    and coalesce(cardinality(p_termos), 0) between p_minimo and 16
    and not exists (
      select 1 from unnest(p_termos) as t(termo)
      where t.termo is null or t.termo !~ '^!?[A-Z0-9]{1,30}\*?(\|[A-Z0-9]{1,30}\*?){0,5}$'
    )
$$;

-- subpastas = lista de caminhos-padrão (até 6); caminho = lista de níveis (1 a 4); nível = lista de termos (1 a 6).
-- Lista vazia = a própria pasta do item.
create function public.catalogo_subpastas_validas(p_subpastas jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_caminho jsonb;
  v_nivel jsonb;
  v_termo jsonb;
begin
  if p_subpastas is null or jsonb_typeof(p_subpastas) <> 'array'
    or jsonb_array_length(p_subpastas) > 6 or octet_length(p_subpastas::text) > 4000 then
    return false;
  end if;

  for v_caminho in select e.value from jsonb_array_elements(p_subpastas) as e loop
    if jsonb_typeof(v_caminho) <> 'array' or jsonb_array_length(v_caminho) not between 1 and 4 then
      return false;
    end if;
    for v_nivel in select e.value from jsonb_array_elements(v_caminho) as e loop
      if jsonb_typeof(v_nivel) <> 'array' or jsonb_array_length(v_nivel) not between 1 and 6 then
        return false;
      end if;
      for v_termo in select e.value from jsonb_array_elements(v_nivel) as e loop
        if jsonb_typeof(v_termo) <> 'string' or (v_termo #>> '{}') !~ '^!?[A-Z0-9]{1,30}\*?(\|[A-Z0-9]{1,30}\*?){0,5}$' then
          return false;
        end if;
      end loop;
    end loop;
  end loop;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. catalogo_pastas
-- ---------------------------------------------------------------------------

create table public.catalogo_pastas (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique check (chave ~ '^[a-z][a-z0-9_]{1,39}$'),
  rotulo text not null check (char_length(btrim(rotulo)) between 1 and 120),
  -- Pasta de primeiro nível do empreendimento (ex.: '03 - PRODUTOS'); o número da frente não entra na comparação.
  raiz text not null check (char_length(btrim(raiz)) between 1 and 80),
  -- Palavras que TODAS precisam aparecer no nome normalizado da pasta; termos_excluir: nenhuma pode aparecer.
  termos text[] not null check (public.catalogo_termos_validos(termos, 1)),
  termos_excluir text[] not null default '{}' check (public.catalogo_termos_validos(termos_excluir, 0)),
  fase text not null check (fase in ('base', 'complementar')),
  tipo text not null check (tipo in ('projeto', 'grupo', 'equipamentos')),
  modelo_id uuid references public.modelos_etapas (id) on delete set null,
  nome_projeto text check (char_length(btrim(nome_projeto)) between 1 and 160),
  -- Categoria do projeto que recebe os documentos da regra (comparada sem diferenciar caixa).
  categoria text check (char_length(btrim(categoria)) between 1 and 120),
  grupo text check (grupo in ('contratos', 'orcamentos')),
  subpastas jsonb not null default '[]'::jsonb check (public.catalogo_subpastas_validas(subpastas)),
  -- 'sistema' = o projeto depende do SAA ou do SES, conforme o nome da pasta; ou a chave de outro item.
  depende_de text check (depende_de = 'sistema' or depende_de ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Só para tipo 'equipamentos': chave do item cujo projeto recebe o SIMOS e os Laudos.
  destino_equipamentos text check (destino_equipamentos ~ '^[a-z][a-z0-9_]{1,39}$'),
  ordem integer not null default 0 check (ordem between 0 and 1000),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint catalogo_pastas_forma_check check (
    (tipo = 'projeto' and nome_projeto is not null and grupo is null and destino_equipamentos is null)
    or (tipo = 'grupo' and grupo is not null and modelo_id is null and nome_projeto is null and categoria is null
        and depende_de is null and destino_equipamentos is null)
    or (tipo = 'equipamentos' and destino_equipamentos is not null and grupo is null and modelo_id is null
        and nome_projeto is null and categoria is null and depende_de is null)
  ),
  -- Projeto complementar depende de outro projeto; só projeto tem fase complementar.
  constraint catalogo_pastas_complementar_check check (fase = 'base' or (tipo = 'projeto' and depende_de is not null))
);

create index catalogo_pastas_modelo_id_idx on public.catalogo_pastas (modelo_id);

create trigger catalogo_pastas_definir_atualizado_em
  before update on public.catalogo_pastas
  for each row execute function public.definir_atualizado_em();

create trigger catalogo_pastas_registrar_auditoria
  after insert or update or delete on public.catalogo_pastas
  for each row execute function public.registrar_auditoria();

alter table public.catalogo_pastas enable row level security;

revoke all on table public.catalogo_pastas from anon;
revoke all on table public.catalogo_pastas from authenticated;
grant select, insert, update, delete on table public.catalogo_pastas to authenticated;

create policy "servidor.regras, empreendimentos.editar ou admin lê o catálogo de pastas"
  on public.catalogo_pastas
  for select
  to authenticated
  using (
    (select public.tem_permissao('servidor.regras'))
    or (select public.tem_permissao('empreendimentos.editar'))
    or (select public.e_admin())
  );

create policy "admin insere no catálogo de pastas"
  on public.catalogo_pastas
  for insert
  to authenticated
  with check ((select public.e_admin()));

create policy "admin atualiza o catálogo de pastas"
  on public.catalogo_pastas
  for update
  to authenticated
  using ((select public.e_admin()))
  with check ((select public.e_admin()));

create policy "admin apaga do catálogo de pastas"
  on public.catalogo_pastas
  for delete
  to authenticated
  using ((select public.e_admin()));

-- ---------------------------------------------------------------------------
-- 3. Seed (seção 2 do contrato). Modelo ausente: modelo_id nulo e ativo = false.
-- ---------------------------------------------------------------------------

insert into public.catalogo_pastas
  (chave, rotulo, raiz, termos, termos_excluir, fase, tipo, modelo_id, nome_projeto, categoria, grupo, subpastas, depende_de, destino_equipamentos, ordem, ativo)
select v.chave, v.rotulo, v.raiz, v.termos, v.termos_excluir, v.fase, v.tipo, m.id, v.nome_projeto, v.categoria, v.grupo,
       v.subpastas::jsonb, v.depende_de, v.destino_equipamentos, v.ordem, (v.tipo <> 'projeto' or m.id is not null)
from (values
  ('saa', 'Sistema de Abastecimento de Água (SAA)', '03 - PRODUTOS', array['SAA']::text[],
    array['PER', 'PEC', 'TERMO', 'ORDEM', 'SIMOS', 'LAUDOS', 'DOACAO', 'DESCRICAO', 'TOPOGRAFICA', 'ESTRUTURAL', 'CONSULTORIA']::text[],
    'base', 'projeto', 'Sistema de Abastecimento de Água - SAA', 'Sistema de Abastecimento de Água - SAA', 'Projetos', null::text,
    '[[["APROVAD*"]]]', null::text, null::text, 10),
  ('ses', 'Sistema de Esgotamento Sanitário (SES)', '03 - PRODUTOS', array['SES']::text[],
    array['PER', 'PEC', 'TERMO', 'ORDEM', 'SIMOS', 'LAUDOS', 'DOACAO', 'DESCRICAO', 'TOPOGRAFICA', 'ESTRUTURAL', 'CONSULTORIA']::text[],
    'base', 'projeto', 'Sistema de Esgotamento Sanitário - SES', 'Sistema de Esgotamento Sanitário - SES', 'Projetos', null::text,
    '[[["APROVAD*"]]]', null::text, null::text, 20),
  ('dt', 'Descrição Topográfica', '03 - PRODUTOS', array['DESCRICAO', 'TOPOGRAFICA']::text[], array[]::text[],
    'complementar', 'projeto', 'Descrição Topográfica', 'Descrição Topográfica', 'Projetos', null::text,
    '[[["APROVAD*"]]]', 'sistema', null::text, 30),
  ('per', 'Projeto Elétrico Referência (PER)', '03 - PRODUTOS', array['PER']::text[], array['PEC']::text[],
    'complementar', 'projeto', 'Projeto Elétrico Referência - PER', 'Projeto Elétrico Referência - PER', 'Projetos', null::text,
    '[[["APROVAD*"]]]', 'sistema', null::text, 40),
  ('pec', 'Projeto Elétrico Construtivo (PEC)', '03 - PRODUTOS', array['PEC']::text[], array[]::text[],
    'complementar', 'projeto', 'Projeto Elétrico Construtivo - PEC', 'Projeto Elétrico Construtivo - PEC', 'Projetos', null::text,
    '[[["APROVAD*"]]]', 'sistema', null::text, 50),
  ('estrutural_reservatorio', 'Projeto Estrutural do Reservatório', '03 - PRODUTOS', array['ESTRUTURAL', 'RESERVATORIO|REL']::text[], array[]::text[],
    'complementar', 'projeto', 'Projeto Estrutural', 'Projeto Estrutural do Reservatório', 'Projetos', null::text,
    '[[["APROVAD*"]]]', 'sistema', null::text, 60),
  ('estrutural_elevatoria', 'Projeto Estrutural da Elevatória', '03 - PRODUTOS', array['ESTRUTURAL', 'ELEVATORIA|EAT|EEE']::text[], array[]::text[],
    'complementar', 'projeto', 'Projeto Estrutural', 'Projeto Estrutural da Elevatória', 'Projetos', null::text,
    '[[["APROVAD*"]]]', 'sistema', null::text, 70),
  ('termo', 'Termo de Acordo e Plano de Trabalho', '03 - PRODUTOS', array['TERMO', 'ACORDO']::text[], array[]::text[],
    'base', 'projeto', 'Termo de Acordo e Plano de Trabalho', 'Termo de Acordo e Plano de Trabalho', 'Termo de Acordo e Plano de Trabalho', null::text,
    '[[["APROVAD*"]]]', null::text, null::text, 80),
  ('os', 'Ordem de Serviço', '03 - PRODUTOS', array['ORDEM', 'SERVICO']::text[], array[]::text[],
    'base', 'projeto', 'Ordem de Serviço', 'Ordem de Serviço', 'Ordem de Serviço', null::text,
    '[[["APROVAD*"]]]', null::text, null::text, 90),
  ('simos', 'SIMOS e Laudos', '03 - PRODUTOS', array['SIMOS']::text[], array[]::text[],
    'base', 'equipamentos', null::text, null::text, null::text, null::text,
    '[]', null::text, 'os', 95),
  ('doacao', 'Doação de Bens', '03 - PRODUTOS', array['DOACAO']::text[], array[]::text[],
    'base', 'projeto', 'Doação de Bens', 'Doação de Bens', 'Guias de Desoneração', null::text,
    '[[["BENS", "IMOVEIS"], ["DESONERACAO"]], [["BENS", "MOVEIS"], ["DESONERACAO"]]]', null::text, null::text, 100),
  ('contratos', 'Propostas e contratos assinados', '02 - FINANCEIRO', array['PROPOSTA', 'CONTRATO']::text[], array[]::text[],
    'base', 'grupo', null::text, null::text, null::text, 'contratos',
    '[[["ASSINAD*"]]]', null::text, null::text, 110),
  ('orcamentos', 'Orçamentos de 3º', '02 - FINANCEIRO', array['ORCAMENTO*', '3']::text[], array['MATERIAIS']::text[],
    'base', 'grupo', null::text, null::text, null::text, 'orcamentos',
    '[]', null::text, null::text, 120)
) as v(chave, rotulo, raiz, termos, termos_excluir, fase, tipo, modelo_nome, nome_projeto, categoria, grupo, subpastas, depende_de, destino_equipamentos, ordem)
left join public.modelos_etapas m on m.nome = v.modelo_nome;

-- ---------------------------------------------------------------------------
-- 4. empreendimentos.ler_complementares
-- ---------------------------------------------------------------------------

-- Sem grant por coluna em empreendimentos: o privilégio de tabela já cobre a coluna e a política "empreendimentos.editar
-- atualiza empreendimentos" decide quem liga. A auditoria genérica da tabela registra a mudança.
alter table public.empreendimentos
  add column ler_complementares boolean not null default false;

-- ---------------------------------------------------------------------------
-- 5. montar_empreendimento_de_pastas
-- ---------------------------------------------------------------------------

-- p_itens = [{ "chave": "saa", "caminhos": ["03 - PRODUTOS/..."], "projeto_pai_chave": null, "nome_projeto": "..." }].
-- Erros de regra de negócio usam errcode P0001 com mensagem em português (o site mostra a mensagem). Tudo roda numa
-- transação: qualquer erro desfaz tudo. Idempotente: projeto do mesmo modelo e nome é reaproveitado (a hierarquia dele
-- não é mexida) e regra com o mesmo caminho é pulada.
create function public.montar_empreendimento_de_pastas(p_empreendimento uuid, p_itens jsonb)
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

commit;
