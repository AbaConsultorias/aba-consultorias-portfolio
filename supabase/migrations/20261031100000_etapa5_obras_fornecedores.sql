begin;

do $$
begin
  if exists (select 1 from public.obra_empreiteiros v join public.profiles p on p.id = v.profile_id where p.papel <> 'empreiteiro') then
    raise exception 'Etapa 5: vínculos de obra com papel incompatível; revisar antes de migrar.';
  end if;
  if exists (select 1 from public.fornecedor_usuarios v join public.profiles p on p.id = v.profile_id where p.papel <> 'fornecedor') then
    raise exception 'Etapa 5: vínculos de fornecedor com papel incompatível; revisar antes de migrar.';
  end if;
  if exists (select 1 from public.fornecedores where cnpj is not null and cnpj !~ '^[0-9]{14}$') then
    raise exception 'Etapa 5: CNPJ fora do formato; revisar antes de migrar.';
  end if;
  if exists (select 1 from public.relatos_obra where status = 'devolvido' and coalesce(length(btrim(motivo_devolucao)), 0) < 3) then
    raise exception 'Etapa 5: relato devolvido sem motivo válido; revisar antes de migrar.';
  end if;
  if exists (select 1 from public.fornecedor_documentos where status = 'recusado' and coalesce(length(btrim(motivo)), 0) < 3) then
    raise exception 'Etapa 5: documento recusado sem motivo válido; revisar antes de migrar.';
  end if;
end $$;

alter table public.fornecedores add constraint fornecedores_cnpj_formato_check
  check (cnpj is null or cnpj ~ '^[0-9]{14}$');

create function public.validar_vinculos_acesso()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_table_name = 'obra_empreiteiros' then
    if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.papel = 'empreiteiro') then
      raise exception 'Vínculo exige empreiteiro.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      if new.id is distinct from old.id or new.obra_id is distinct from old.obra_id or new.profile_id is distinct from old.profile_id then
        raise exception 'Vínculo não pode ser transferido.' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'fornecedor_usuarios' then
    if not exists (select 1 from public.profiles p where p.id = new.profile_id and p.papel = 'fornecedor') then
      raise exception 'Vínculo exige fornecedor.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      if new.id is distinct from old.id or new.fornecedor_id is distinct from old.fornecedor_id or new.profile_id is distinct from old.profile_id then
        raise exception 'Vínculo não pode ser transferido.' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.validar_vinculos_acesso() from public, anon, authenticated;

create trigger obra_empreiteiros_validar_vinculos_acesso
  before insert or update on public.obra_empreiteiros
  for each row execute function public.validar_vinculos_acesso();
create trigger fornecedor_usuarios_validar_vinculos_acesso
  before insert or update on public.fornecedor_usuarios
  for each row execute function public.validar_vinculos_acesso();

create function public.validar_revisao_relato_obra()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.obra_id is distinct from old.obra_id
    or new.autor_id is distinct from old.autor_id or new.texto is distinct from old.texto
    or new.percentual_informado is distinct from old.percentual_informado
    or new.situacao_informada is distinct from old.situacao_informada then
    raise exception 'Conteúdo do relato é imutável.' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pendente' then
      raise exception 'Relato já revisado.' using errcode = '55000';
    end if;
    if new.status is null or new.status not in ('aprovado', 'devolvido') then
      raise exception 'Revisão inválida.' using errcode = '23514';
    end if;
  end if;
  if new.status = 'devolvido' and coalesce(length(btrim(new.motivo_devolucao)), 0) < 3 then
    raise exception 'Informe o motivo da devolução.' using errcode = '23514';
  end if;
  if new.status = 'aprovado' then new.motivo_devolucao := null; end if;
  return new;
end $$;
revoke execute on function public.validar_revisao_relato_obra() from public, anon, authenticated;
create trigger relatos_obra_validar_revisao before update on public.relatos_obra
  for each row execute function public.validar_revisao_relato_obra();

create function public.validar_revisao_documento_fornecedor()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.fornecedor_id is distinct from old.fornecedor_id
    or new.enviado_por is distinct from old.enviado_por or new.tipo is distinct from old.tipo
    or new.titulo is distinct from old.titulo or new.storage_path is distinct from old.storage_path
    or new.mime is distinct from old.mime or new.tamanho is distinct from old.tamanho then
    raise exception 'Conteúdo do documento é imutável.' using errcode = '23514';
  end if;
  if new.empreendimento_id is distinct from old.empreendimento_id then
    if new.empreendimento_id is not null or exists (select 1 from public.empreendimentos e where e.id = old.empreendimento_id) then
      raise exception 'Documento não pode ser transferido.' using errcode = '23514';
    end if;
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pendente' then
      raise exception 'Documento já revisado.' using errcode = '55000';
    end if;
    if new.status is null or new.status not in ('aprovado', 'recusado') then
      raise exception 'Revisão inválida.' using errcode = '23514';
    end if;
  end if;
  if new.status = 'recusado' and coalesce(length(btrim(new.motivo)), 0) < 3 then
    raise exception 'Informe o motivo da recusa.' using errcode = '23514';
  end if;
  if new.status = 'aprovado' then new.motivo := null; end if;
  return new;
end $$;
revoke execute on function public.validar_revisao_documento_fornecedor() from public, anon, authenticated;
create trigger fornecedor_documentos_validar_revisao before update on public.fornecedor_documentos
  for each row execute function public.validar_revisao_documento_fornecedor();

create function public.validar_contrato_fornecedor()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.fornecedor_id is distinct from old.fornecedor_id
    or new.storage_path is distinct from old.storage_path or new.mime is distinct from old.mime
    or new.tamanho is distinct from old.tamanho then
    raise exception 'Arquivo do contrato é imutável.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.validar_contrato_fornecedor() from public, anon, authenticated;
create trigger fornecedor_contratos_validar before update on public.fornecedor_contratos
  for each row execute function public.validar_contrato_fornecedor();

create function public.enviar_relato_obra(
  p_obra uuid, p_relato uuid, p_texto text, p_percentual int,
  p_situacao public.obra_situacao, p_fotos jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := auth.uid();
  v_existente public.relatos_obra%rowtype;
  v_foto jsonb;
  v_extensao text;
  v_foto_id uuid;
begin
  if not public.empreiteiro_da_obra(p_obra) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  perform 1 from public.obras o where o.id = p_obra for update;
  if not found then raise exception 'Obra indisponível.' using errcode = 'P0002'; end if;
  if not public.empreiteiro_da_obra(p_obra) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_relato is null then raise exception 'Relato inválido.' using errcode = '23514'; end if;
  select r.* into v_existente from public.relatos_obra r where r.id = p_relato;
  if found then
    if v_existente.autor_id = v_autor and v_existente.obra_id = p_obra then return p_relato; end if;
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_texto is null or length(btrim(p_texto)) not between 3 and 5000
    or (p_percentual is not null and p_percentual not between 0 and 100) then
    raise exception 'Relato inválido.' using errcode = '23514';
  end if;
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' then
    raise exception 'Lista de fotos inválida.' using errcode = '23514';
  end if;
  if jsonb_array_length(p_fotos) > 10 then
    raise exception 'Limite de fotos excedido.' using errcode = '23514';
  end if;
  for v_foto in select elem.value from jsonb_array_elements(p_fotos) as elem loop
    if jsonb_typeof(v_foto) <> 'object' then
      raise exception 'Foto inválida.' using errcode = '23514';
    end if;
    if jsonb_typeof(v_foto->'id') is distinct from 'string'
      or (v_foto->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_foto->'path') is distinct from 'string'
      or jsonb_typeof(v_foto->'mime') is distinct from 'string'
      or jsonb_typeof(v_foto->'tamanho') is distinct from 'number'
      or exists (select 1 from jsonb_object_keys(v_foto) as chave(nome) where chave.nome not in ('id', 'path', 'mime', 'tamanho')) then
      raise exception 'Foto inválida.' using errcode = '23514';
    end if;
    if (v_foto->>'tamanho') !~ '^[0-9]+$' then
      raise exception 'Tamanho inválido.' using errcode = '23514';
    end if;
    if (v_foto->>'tamanho')::numeric not between 1 and 10485760 then
      raise exception 'Tamanho inválido.' using errcode = '23514';
    end if;
    v_foto_id := (v_foto->>'id')::uuid;
    v_extensao := case v_foto->>'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
      when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'image/heif' then 'heif' end;
    if v_extensao is null or v_foto->>'path' <> 'relatos/' || p_obra::text || '/' || p_relato::text || '/' || v_foto_id::text || '.' || v_extensao then
      raise exception 'Caminho ou formato de foto inválido.' using errcode = '23514';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_fotos) as elem group by (elem.value->>'id')::uuid having count(*) > 1) then
    raise exception 'Fotos repetidas.' using errcode = '23514';
  end if;
  if (select count(*) from public.relatos_obra r where r.obra_id = p_obra and r.autor_id = v_autor and r.status = 'pendente') >= 5 then
    raise exception 'Limite de relatos pendentes atingido.' using errcode = '54000';
  end if;
  insert into public.relatos_obra (id, obra_id, autor_id, texto, percentual_informado, situacao_informada, status)
    values (p_relato, p_obra, v_autor, btrim(p_texto), p_percentual, p_situacao, 'pendente');
  insert into public.relato_fotos (id, relato_id, storage_path, mime, tamanho)
    select (elem.value->>'id')::uuid, p_relato, elem.value->>'path', elem.value->>'mime', (elem.value->>'tamanho')::bigint
    from jsonb_array_elements(p_fotos) as elem;
  return p_relato;
end $$;
revoke execute on function public.enviar_relato_obra(uuid, uuid, text, int, public.obra_situacao, jsonb) from public, anon;
grant execute on function public.enviar_relato_obra(uuid, uuid, text, int, public.obra_situacao, jsonb) to authenticated;

create function public.revisar_relato_obra(
  p_relato uuid, p_acao text, p_motivo text, p_percentual int, p_situacao public.obra_situacao
)
returns void language plpgsql security invoker set search_path = '' as $$
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
end $$;
revoke execute on function public.revisar_relato_obra(uuid, text, text, int, public.obra_situacao) from public, anon;
grant execute on function public.revisar_relato_obra(uuid, text, text, int, public.obra_situacao) to authenticated;

create function public.enviar_documento_fornecedor(
  p_id uuid, p_fornecedor uuid, p_empreendimento uuid, p_tipo text,
  p_titulo text, p_path text, p_mime text, p_tamanho bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_autor uuid := auth.uid();
  v_existente public.fornecedor_documentos%rowtype;
  v_extensao text;
begin
  if not public.usuario_do_fornecedor(p_fornecedor) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  perform 1 from public.fornecedores f where f.id = p_fornecedor for update;
  if not found then raise exception 'Fornecedor indisponível.' using errcode = 'P0002'; end if;
  if not public.usuario_do_fornecedor(p_fornecedor) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if p_id is null then raise exception 'Documento inválido.' using errcode = '23514'; end if;
  select d.* into v_existente from public.fornecedor_documentos d where d.id = p_id;
  if found then
    if v_existente.fornecedor_id = p_fornecedor and v_existente.enviado_por = v_autor then return p_id; end if;
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if exists (select 1 from public.auditoria a where a.tabela = 'fornecedor_documentos' and a.registro_id = p_id and a.acao = 'DELETE') then
    raise exception 'Documento já excluído; inicie novo envio.' using errcode = '23514';
  end if;
  if p_empreendimento is not null and not exists (
    select 1 from public.itens_financeiros i where i.fornecedor_id = p_fornecedor and i.empreendimento_id = p_empreendimento
  ) then raise exception 'Empreendimento indisponível.' using errcode = '42501'; end if;
  if p_tipo is null or p_tipo not in ('nota_fiscal', 'certidao', 'comprovante', 'proposta', 'outro')
    or p_titulo is null or length(btrim(p_titulo)) not between 2 and 160
    or p_tamanho is null or p_tamanho not between 1 and 20971520 then
    raise exception 'Documento inválido.' using errcode = '23514';
  end if;
  v_extensao := case p_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' end;
  if v_extensao is null or p_path is null or p_path <> p_fornecedor::text || '/documentos/' || p_id::text || '.' || v_extensao then
    raise exception 'Caminho ou formato inválido.' using errcode = '23514';
  end if;
  if (select count(*) from public.fornecedor_documentos d where d.fornecedor_id = p_fornecedor and d.status = 'pendente') >= 20 then
    raise exception 'Limite de documentos pendentes atingido.' using errcode = '54000';
  end if;
  insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, empreendimento_id, tipo, titulo, storage_path, mime, tamanho, status)
    values (p_id, p_fornecedor, v_autor, p_empreendimento, p_tipo, btrim(p_titulo), p_path, p_mime, p_tamanho, 'pendente');
  return p_id;
end $$;
revoke execute on function public.enviar_documento_fornecedor(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.enviar_documento_fornecedor(uuid, uuid, uuid, text, text, text, text, bigint) to authenticated;

create trigger relato_fotos_registrar_auditoria after insert or update or delete on public.relato_fotos
  for each row execute function public.registrar_auditoria();
create index if not exists relatos_obra_status_criado_em_idx on public.relatos_obra (status, criado_em);
create index if not exists fornecedor_documentos_status_criado_em_idx on public.fornecedor_documentos (status, criado_em);

drop policy "fornecedores: staff envia" on storage.objects;
drop policy "fornecedores: staff atualiza" on storage.objects;
drop policy "fornecedores: staff apaga" on storage.objects;

do $$
begin
  if (select count(*) from storage.buckets b where b.id in ('obras', 'documentos', 'fornecedores') and not b.public) <> 3 then
    raise exception 'Etapa 5: os três buckets devem existir e ser privados.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd <> 'SELECT'
      and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ '''(obras|documentos|fornecedores)'''
  ) then
    raise exception 'Etapa 5: ainda há política de escrita direta nos buckets privados.';
  end if;
end $$;

commit;
