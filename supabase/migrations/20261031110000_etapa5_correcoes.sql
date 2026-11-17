begin;

do $$
begin
  if exists (select 1 from public.relatos_obra where length(texto) > 5000) then
    raise exception 'Etapa 5: relato com texto acima de 5000 caracteres; revisar antes de migrar.';
  end if;
end $$;

drop policy "empreiteiro registra relato pendente" on public.relatos_obra;

alter table public.relatos_obra add constraint relatos_obra_texto_tamanho_check
  check (length(texto) <= 5000);

create or replace function public.enviar_relato_obra(
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
  if exists (
    select 1 from jsonb_array_elements(p_fotos) as elem
    where not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'obras' and o.name = elem.value->>'path'
        and (o.metadata->>'size')::bigint = (elem.value->>'tamanho')::bigint
    )
  ) then
    raise exception 'Arquivo não encontrado no armazenamento.' using errcode = '23514';
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

create or replace function public.enviar_documento_fornecedor(
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
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'fornecedores' and o.name = p_path
      and (o.metadata->>'size')::bigint = p_tamanho
  ) then
    raise exception 'Arquivo não encontrado no armazenamento.' using errcode = '23514';
  end if;
  insert into public.fornecedor_documentos (id, fornecedor_id, enviado_por, empreendimento_id, tipo, titulo, storage_path, mime, tamanho, status)
    values (p_id, p_fornecedor, v_autor, p_empreendimento, p_tipo, btrim(p_titulo), p_path, p_mime, p_tamanho, 'pendente');
  return p_id;
end $$;
revoke execute on function public.enviar_documento_fornecedor(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.enviar_documento_fornecedor(uuid, uuid, uuid, text, text, text, text, bigint) to authenticated;

commit;
