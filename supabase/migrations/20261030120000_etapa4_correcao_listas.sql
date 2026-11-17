begin;

-- As três funções declaram a variável v e também usam v como alias de jsonb_array_elements nas
-- subconsultas; o PL/pgSQL recusa a ambiguidade. Dentro de uma consulta, v é sempre o alias.

create or replace function public.validar_lista_portal(p_lista jsonb, p_etapas boolean, p_projeto boolean)
returns void language plpgsql security invoker set search_path = '' as $$
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
end $$;

create or replace function public.salvar_modelo_portal(p_id uuid, p_nome text, p_descricao text, p_ativo boolean, p_etapas jsonb, p_categorias jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
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
end $$;

create or replace function public.salvar_etapas_projeto_portal(p_projeto uuid, p_etapa_atual uuid, p_etapas jsonb, p_categorias jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
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
end $$;

commit;
