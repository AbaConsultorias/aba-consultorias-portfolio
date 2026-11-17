begin;

do $$
begin
  if exists (select 1 from public.empreendimento_clientes v join public.profiles p on p.id = v.profile_id where p.papel <> 'cliente') then
    raise exception 'Portal: vínculos com papel incompatível; revisar antes de migrar.';
  end if;
  if exists (select 1 from public.projetos p join public.projeto_etapas e on e.id = p.etapa_atual_id where e.projeto_id <> p.id)
    or exists (select 1 from public.atualizacoes a left join public.projetos p on p.id = a.projeto_id left join public.projeto_etapas e on e.id = a.etapa_id where p.empreendimento_id <> a.empreendimento_id or (a.etapa_id is not null and (a.projeto_id is null or e.projeto_id <> a.projeto_id)))
    or exists (select 1 from public.documentos d left join public.projetos p on p.id = d.projeto_id left join public.projeto_categorias_documento c on c.id = d.categoria_id where p.empreendimento_id <> d.empreendimento_id or (d.categoria_id is not null and (d.projeto_id is null or c.projeto_id <> d.projeto_id))) then
    raise exception 'Portal: relações cruzadas inconsistentes; revisar antes de migrar.';
  end if;
end $$;

create function public.validar_vinculos_portal()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'empreendimento_clientes' then
    if not exists (select 1 from public.profiles where id = new.profile_id and papel = 'cliente') then
      raise exception 'Vínculo exige cliente.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and (new.empreendimento_id <> old.empreendimento_id or new.profile_id <> old.profile_id) then
      raise exception 'Vínculo não pode ser transferido.' using errcode = '23514';
    end if;
  elsif tg_table_name = 'projetos' then
    if tg_op = 'UPDATE' and (new.empreendimento_id <> old.empreendimento_id or (new.modelo_origem_id is not null and new.modelo_origem_id is distinct from old.modelo_origem_id)) then
      raise exception 'Projeto não pode ser transferido.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and new.modelo_origem_id is not null then
      perform 1 from public.modelos_etapas where id = new.modelo_origem_id and ativo for share;
      if not found then raise exception 'Modelo inativo ou indisponível.' using errcode = '23514'; end if;
    end if;
    if new.etapa_atual_id is not null and not exists (select 1 from public.projeto_etapas where id = new.etapa_atual_id and projeto_id = new.id) then
      raise exception 'Etapa atual não pertence ao projeto.' using errcode = '23514';
    end if;
  elsif tg_table_name in ('projeto_etapas', 'projeto_categorias_documento') then
    if tg_op = 'UPDATE' and new.projeto_id <> old.projeto_id then
      raise exception 'Filho não pode ser transferido.' using errcode = '23514';
    end if;
    perform 1 from public.projetos where id = new.projeto_id for update;
  else
    if tg_op = 'UPDATE' then
      -- Reclassificar entre projetos do mesmo empreendimento é permitido: o projeto novo e a
      -- etapa/categoria são validados abaixo. O empreendimento nunca muda.
      if new.empreendimento_id <> old.empreendimento_id then
        raise exception 'Registro não pode ser transferido.' using errcode = '23514';
      end if;
      -- A FK do projeto pode executar SET NULL antes da FK da etapa/categoria.
      if old.projeto_id is not null and new.projeto_id is null and not exists (select 1 from public.projetos where id = old.projeto_id) then
        if tg_table_name = 'atualizacoes' then new.etapa_id := null; else new.categoria_id := null; end if;
      end if;
    end if;
    -- Na exclusão do projeto, a FK da etapa/categoria pode rodar SET NULL depois de o projeto
    -- sumir: sem mudança para um valor novo, não há o que revalidar nem projeto a trancar.
    if new.projeto_id is not null and (tg_op = 'INSERT' or new.projeto_id is distinct from old.projeto_id
      or (tg_table_name = 'atualizacoes' and new.etapa_id is not null and new.etapa_id is distinct from old.etapa_id)
      or (tg_table_name = 'documentos' and new.categoria_id is not null and new.categoria_id is distinct from old.categoria_id)) then
      perform 1 from public.projetos where id = new.projeto_id and empreendimento_id = new.empreendimento_id for update;
      if not found then raise exception 'Projeto não pertence ao empreendimento.' using errcode = '23514'; end if;
    end if;
    if tg_table_name = 'atualizacoes' then
      if new.etapa_id is not null and (new.projeto_id is null or not exists (select 1 from public.projeto_etapas where id = new.etapa_id and projeto_id = new.projeto_id)) then
        raise exception 'Etapa não pertence ao projeto.' using errcode = '23514';
      end if;
    elsif new.categoria_id is not null and (new.projeto_id is null or not exists (select 1 from public.projeto_categorias_documento where id = new.categoria_id and projeto_id = new.projeto_id)) then
      raise exception 'Categoria não pertence ao projeto.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.validar_vinculos_portal() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['empreendimento_clientes','projetos','projeto_etapas','projeto_categorias_documento','atualizacoes','documentos'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validar_vinculos_portal()', t || '_validar_vinculos_portal', t);
  end loop;
  foreach t in array array['modelos_etapas','modelo_etapas_itens','modelo_categorias_documento','projeto_etapas','projeto_categorias_documento','atualizacoes','atualizacao_fotos'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t || '_registrar_auditoria', t);
  end loop;
end $$;

alter table public.modelo_etapas_itens drop constraint modelo_etapas_itens_modelo_id_ordem_key,
  add constraint modelo_etapas_itens_modelo_id_ordem_key unique (modelo_id, ordem) deferrable initially deferred;
alter table public.modelo_categorias_documento drop constraint modelo_categorias_documento_modelo_id_nome_key,
  add constraint modelo_categorias_documento_modelo_id_nome_key unique (modelo_id, nome) deferrable initially deferred;
alter table public.projeto_categorias_documento drop constraint projeto_categorias_documento_projeto_id_nome_key,
  add constraint projeto_categorias_documento_projeto_id_nome_key unique (projeto_id, nome) deferrable initially deferred;

create function public.validar_lista_portal(p_lista jsonb, p_etapas boolean, p_projeto boolean)
returns void language plpgsql security invoker set search_path = '' as $$
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
revoke execute on function public.validar_lista_portal(jsonb, boolean, boolean) from public, anon;
grant execute on function public.validar_lista_portal(jsonb, boolean, boolean) to authenticated;

create function public.salvar_modelo_portal(p_id uuid, p_nome text, p_descricao text, p_ativo boolean, p_etapas jsonb, p_categorias jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
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

create function public.salvar_etapas_projeto_portal(p_projeto uuid, p_etapa_atual uuid, p_etapas jsonb, p_categorias jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
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
revoke execute on function public.salvar_modelo_portal(uuid,text,text,boolean,jsonb,jsonb) from public, anon;
revoke execute on function public.salvar_etapas_projeto_portal(uuid,uuid,jsonb,jsonb) from public, anon;
grant execute on function public.salvar_modelo_portal(uuid,text,text,boolean,jsonb,jsonb) to authenticated;
grant execute on function public.salvar_etapas_projeto_portal(uuid,uuid,jsonb,jsonb) to authenticated;

create function public.excluir_item_financeiro_portal(p_item uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not public.e_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  -- O item é trancado primeiro (a inclusão concorrente de parcela espera) e as parcelas depois (o
  -- pagamento concorrente espera): a checagem e o cascade enxergam o mesmo estado.
  select id into v_id from public.itens_financeiros where id = p_item for update;
  if not found then return null; end if;
  perform 1 from public.parcelas where item_id = p_item for update;
  if exists (select 1 from public.parcelas where item_id = p_item and (data_pagamento is not null or valor_pago_centavos > 0)) then
    raise exception 'Item com pagamento registrado.' using errcode = '23503';
  end if;
  delete from public.itens_financeiros where id = p_item;
  return v_id;
end $$;
revoke execute on function public.excluir_item_financeiro_portal(uuid) from public, anon;
grant execute on function public.excluir_item_financeiro_portal(uuid) to authenticated;

drop policy "documentos: staff envia" on storage.objects;
drop policy "documentos: staff atualiza" on storage.objects;
drop policy "documentos: staff apaga" on storage.objects;
drop policy "obras: staff envia" on storage.objects;
drop policy "obras: staff atualiza" on storage.objects;
drop policy "obras: staff apaga" on storage.objects;

do $$
begin
  if exists (
    select 1 from pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd <> 'SELECT'
      and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ '''(obras|documentos)'''
  ) then
    raise exception 'Portal: ainda há política de escrita direta nos buckets documentos/obras.';
  end if;
end $$;

commit;
