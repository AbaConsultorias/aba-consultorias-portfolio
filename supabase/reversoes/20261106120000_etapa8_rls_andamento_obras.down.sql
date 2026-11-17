-- Desfaz supabase/migrations/20261106120000_etapa8_rls_andamento_obras.sql.
-- Políticas, funções e triggers voltam ao texto de produção de docs/etapa8-estado-banco-antes-rls.json.
-- pode_ver_empreendimento tinha fim de linha CRLF no corpo; o replace(chr(10), chr(13) || chr(10))
-- devolve o prosrc byte a byte.

begin;

-- Funções

create or replace function public.revisar_relato_obra(p_relato uuid, p_acao text, p_motivo text, p_percentual integer, p_situacao public.obra_situacao)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_relato public.relatos_obra%rowtype;
begin
  if not public.e_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select r.* into v_relato from public.relatos_obra r where r.id = p_relato for update;
  if not found then raise exception 'Relato indisponível.' using errcode = 'P0002'; end if;
  if v_relato.status <> 'pendente' then raise exception 'Relato já revisado.' using errcode = '55000'; end if;
  perform 1 from public.obras o where o.id = v_relato.obra_id for update;
  if not found then raise exception 'Obra indisponível.' using errcode = 'P0002'; end if;
  if p_acao = 'aprovar' then
    if p_percentual is null or p_percentual not between 0 and 100 or p_situacao is null then
      raise exception 'Confirme percentual e situação.' using errcode = '23514';
    end if;
    update public.relatos_obra set status = 'aprovado', motivo_devolucao = null where id = p_relato;
    update public.obras set percentual = p_percentual, situacao = p_situacao where id = v_relato.obra_id;
  elsif p_acao = 'devolver' then
    if p_motivo is null or length(btrim(p_motivo)) not between 3 and 500 then
      raise exception 'Informe o motivo da devolução.' using errcode = '23514';
    end if;
    update public.relatos_obra set status = 'devolvido', motivo_devolucao = btrim(p_motivo) where id = p_relato;
  else
    raise exception 'Ação de revisão inválida.' using errcode = '23514';
  end if;
end $function$;

create or replace function public.validar_lista_portal(p_lista jsonb, p_etapas boolean, p_projeto boolean)
 returns void
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v jsonb; d date;
begin
  if not public.e_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
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

create or replace function public.salvar_modelo_portal(p_id uuid, p_nome text, p_descricao text, p_ativo boolean, p_etapas jsonb, p_categorias jsonb)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v_id uuid := p_id; v jsonb;
begin
  if not public.e_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
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

create or replace function public.salvar_etapas_projeto_portal(p_projeto uuid, p_etapa_atual uuid, p_etapas jsonb, p_categorias jsonb)
 returns void
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
declare v jsonb; anterior uuid;
begin
  if not public.e_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select etapa_atual_id into anterior from public.projetos where id=p_projeto for update;
  if not found then raise exception 'Projeto indisponível.' using errcode = 'P0002'; end if;
  perform public.validar_lista_portal(p_etapas, true, true);
  perform public.validar_lista_portal(p_categorias, false, true);
  if exists (select 1 from jsonb_array_elements(p_etapas) v where v ? 'id' and not exists (select 1 from public.projeto_etapas where id=(v->>'id')::uuid and projeto_id=p_projeto))
    or exists (select 1 from jsonb_array_elements(p_categorias) v where v ? 'id' and not exists (select 1 from public.projeto_categorias_documento where id=(v->>'id')::uuid and projeto_id=p_projeto)) then
    raise exception 'ID não pertence ao projeto.' using errcode = '23514';
  end if;
  if (p_etapa_atual is not null and not exists (select 1 from jsonb_array_elements(p_etapas) v where (v->>'id')::uuid=p_etapa_atual))
    or (anterior is not null and not exists (select 1 from jsonb_array_elements(p_etapas) v where (v->>'id')::uuid=anterior) and p_etapa_atual is null and jsonb_array_length(p_etapas)>0) then
    raise exception 'Escolha uma etapa atual da lista.' using errcode = '23514';
  end if;
  if exists (select 1 from public.atualizacoes a join public.projeto_etapas e on e.id=a.etapa_id where e.projeto_id=p_projeto and not exists (select 1 from jsonb_array_elements(p_etapas) v where (v->>'id')::uuid=e.id))
    or exists (select 1 from public.documentos d join public.projeto_categorias_documento c on c.id=d.categoria_id where c.projeto_id=p_projeto and not exists (select 1 from jsonb_array_elements(p_categorias) v where (v->>'id')::uuid=c.id)) then
    raise exception 'Etapa ou categoria em uso.' using errcode = '23503';
  end if;
  update public.projetos set etapa_atual_id=p_etapa_atual where id=p_projeto;
  delete from public.projeto_etapas where projeto_id=p_projeto and id not in (select (v->>'id')::uuid from jsonb_array_elements(p_etapas) v where v ? 'id');
  delete from public.projeto_categorias_documento where projeto_id=p_projeto and id not in (select (v->>'id')::uuid from jsonb_array_elements(p_categorias) v where v ? 'id');
  for v in select value from jsonb_array_elements(p_etapas) loop
    if v ? 'id' then update public.projeto_etapas set nome=btrim(v->>'nome'),ordem=(v->>'ordem')::int,concluida_em=case when v ? 'concluidaEm' then (v->>'concluidaEm')::date else concluida_em end where id=(v->>'id')::uuid;
    else insert into public.projeto_etapas (projeto_id,nome,ordem,concluida_em) values (p_projeto,btrim(v->>'nome'),(v->>'ordem')::int,(v->>'concluidaEm')::date); end if;
  end loop;
  for v in select value from jsonb_array_elements(p_categorias) loop
    if v ? 'id' then update public.projeto_categorias_documento set nome=btrim(v->>'nome'),ordem=(v->>'ordem')::int where id=(v->>'id')::uuid;
    else insert into public.projeto_categorias_documento (projeto_id,nome,ordem) values (p_projeto,btrim(v->>'nome'),(v->>'ordem')::int); end if;
  end loop;
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
  if not public.e_staff() then
    raise exception 'Apenas a equipe pode criar projetos.' using errcode = 'insufficient_privilege';
  end if;

  if p_modelo is null then
    raise exception 'O modelo do projeto é obrigatório.' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.projetos (empreendimento_id, modelo_origem_id, nome, projeto_pai_id)
  values (p_empreendimento, p_modelo, p_nome, p_projeto_pai)
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

do $reverter$
begin
  execute replace($def$
create or replace function public.pode_ver_empreendimento(p_empreendimento uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select public.e_staff() or public.cliente_do_empreendimento(p_empreendimento)
$function$
$def$, chr(10), chr(13) || chr(10));
end
$reverter$;

-- relato_fotos e relatos_obra

drop policy "só o administrador anexa fotos ao relato" on public.relato_fotos;
drop policy "só o administrador apaga fotos do relato" on public.relato_fotos;

create policy "staff anexa fotos ao relato"
  on public.relato_fotos
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff apaga fotos do relato"
  on public.relato_fotos
  for delete
  to authenticated
  using ((select public.e_staff()));

drop policy "obras.ver lê relatos de obra" on public.relatos_obra;
drop policy "obras.aprovar atualiza relatos de obra" on public.relatos_obra;
drop policy "só o administrador insere relatos de obra" on public.relatos_obra;
drop policy "só o administrador apaga relatos de obra" on public.relatos_obra;

create policy "staff gerencia relatos de obra"
  on public.relatos_obra
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- obra_empreiteiros e obras

drop policy "obras.ver lê empreiteiros de obra" on public.obra_empreiteiros;
drop policy "obras.editar insere empreiteiros de obra" on public.obra_empreiteiros;
drop policy "obras.editar atualiza empreiteiros de obra" on public.obra_empreiteiros;
drop policy "obras.editar apaga empreiteiros de obra" on public.obra_empreiteiros;

create policy "staff gerencia empreiteiros de obra"
  on public.obra_empreiteiros
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop trigger obras_proteger_aprovacao on public.obras;
drop function public.proteger_aprovacao_obra();

drop policy "obras.ver lê obras" on public.obras;
drop policy "obras.editar insere obras" on public.obras;
drop policy "obras.editar atualiza obras" on public.obras;
drop policy "obras.editar apaga obras" on public.obras;

create policy "staff gerencia obras"
  on public.obras
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- atualizacao_fotos e atualizacoes

drop policy "atualizacoes.ver lê fotos de atualização" on public.atualizacao_fotos;
drop policy "atualizacoes.editar insere fotos de atualização" on public.atualizacao_fotos;
drop policy "atualizacoes.editar atualiza fotos de atualização" on public.atualizacao_fotos;
drop policy "atualizacoes.editar apaga fotos de atualização" on public.atualizacao_fotos;

create policy "staff gerencia fotos de atualização"
  on public.atualizacao_fotos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "atualizacoes.ver lê atualizações" on public.atualizacoes;
drop policy "atualizacoes.editar insere atualizações" on public.atualizacoes;
drop policy "atualizacoes.editar atualiza atualizações" on public.atualizacoes;
drop policy "atualizacoes.editar apaga atualizações" on public.atualizacoes;

create policy "staff gerencia atualizações"
  on public.atualizacoes
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- modelos

drop policy "empreendimentos.ver lê categorias de modelo" on public.modelo_categorias_documento;
drop policy "empreendimentos.editar insere categorias de modelo" on public.modelo_categorias_documento;
drop policy "empreendimentos.editar atualiza categorias de modelo" on public.modelo_categorias_documento;
drop policy "empreendimentos.editar apaga categorias de modelo" on public.modelo_categorias_documento;

create policy "staff gerencia categorias de modelo"
  on public.modelo_categorias_documento
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "empreendimentos.ver lê itens de modelo" on public.modelo_etapas_itens;
drop policy "empreendimentos.editar insere itens de modelo" on public.modelo_etapas_itens;
drop policy "empreendimentos.editar atualiza itens de modelo" on public.modelo_etapas_itens;
drop policy "empreendimentos.editar apaga itens de modelo" on public.modelo_etapas_itens;

create policy "staff gerencia itens de modelo"
  on public.modelo_etapas_itens
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "empreendimentos.ver lê modelos de etapas" on public.modelos_etapas;
drop policy "empreendimentos.editar insere modelos de etapas" on public.modelos_etapas;
drop policy "empreendimentos.editar atualiza modelos de etapas" on public.modelos_etapas;
drop policy "empreendimentos.editar apaga modelos de etapas" on public.modelos_etapas;

create policy "staff gerencia modelos de etapas"
  on public.modelos_etapas
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- projetos, etapas e categorias

drop policy "empreendimentos.ver lê categorias de projeto" on public.projeto_categorias_documento;
drop policy "empreendimentos.editar insere categorias de projeto" on public.projeto_categorias_documento;
drop policy "empreendimentos.editar atualiza categorias de projeto" on public.projeto_categorias_documento;
drop policy "empreendimentos.editar apaga categorias de projeto" on public.projeto_categorias_documento;

create policy "staff gerencia categorias de projeto"
  on public.projeto_categorias_documento
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "empreendimentos.ver lê etapas de projeto" on public.projeto_etapas;
drop policy "empreendimentos.editar insere etapas de projeto" on public.projeto_etapas;
drop policy "empreendimentos.editar atualiza etapas de projeto" on public.projeto_etapas;
drop policy "empreendimentos.editar apaga etapas de projeto" on public.projeto_etapas;

create policy "staff gerencia etapas de projeto"
  on public.projeto_etapas
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

drop policy "empreendimentos.ver lê projetos" on public.projetos;
drop policy "empreendimentos.editar insere projetos" on public.projetos;
drop policy "empreendimentos.editar atualiza projetos" on public.projetos;
drop policy "empreendimentos.editar apaga projetos" on public.projetos;

create policy "staff gerencia projetos"
  on public.projetos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- empreendimentos

drop trigger empreendimentos_proteger_liberacao on public.empreendimentos;
drop function public.proteger_liberacao_empreendimento();

drop policy "empreendimentos.ver lê empreendimentos" on public.empreendimentos;
drop policy "empreendimentos.editar insere empreendimentos" on public.empreendimentos;
drop policy "empreendimentos.editar atualiza empreendimentos" on public.empreendimentos;
drop policy "só o administrador apaga empreendimentos" on public.empreendimentos;

create policy "staff gerencia empreendimentos"
  on public.empreendimentos
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

commit;
