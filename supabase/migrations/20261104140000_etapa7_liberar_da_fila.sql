-- Etapa 7 — liberar pela fila "Chegaram do servidor" numa transação só (revisão de segurança da onda 3).
-- A API conferia na aplicação se o documento estava na fila e se não havia versão mais nova, e só depois liberava.
-- Entre as duas coisas o conector podia publicar uma versão nova (e a liberação da antiga a ocultaria) ou outra
-- pessoa podia ignorar o documento. Agora a conferência e a liberação acontecem sob o lock da família.
-- "Versão mais nova" é qualquer documento da mesma família criado depois (não só o sucessor direto), para que
-- apagar uma versão intermediária não faça a mais antiga voltar à fila.
begin;

create or replace function public.liberar_documento_do_servidor(p_documento uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_familia uuid;
  v_criado timestamptz;
  v_liberado boolean;
  v_mime text;
begin
  if not (select public.e_staff()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;

  select d.familia_id into v_familia from public.documentos d where d.id = p_documento;
  if not found then
    return 'fora_da_fila';
  end if;

  -- Mesmo lock do trigger documentos_ocultar_versoes_irmas (que a liberação automática do conector também usa).
  perform pg_advisory_xact_lock(hashtextextended('documentos_familia:' || v_familia::text, 0));

  select d.criado_em, d.liberado_cliente, d.mime
    into v_criado, v_liberado, v_mime
    from public.documentos d
   where d.id = p_documento
   for update;
  if not found then
    return 'fora_da_fila';
  end if;
  if v_liberado then
    return 'ja_liberado';
  end if;
  if v_mime <> 'application/pdf' or not exists (
    select 1 from public.documento_origens o where o.documento_id = p_documento and o.ignorado_em is null
  ) then
    return 'fora_da_fila';
  end if;
  if exists (
    select 1 from public.documentos d
     where d.familia_id = v_familia
       and d.id <> p_documento
       and (d.criado_em > v_criado or (d.criado_em = v_criado and d.id > p_documento))
  ) then
    return 'versao_mais_nova';
  end if;

  -- O trigger oculta as outras versões da família neste UPDATE.
  update public.documentos set liberado_cliente = true where id = p_documento;
  return 'liberado';
end;
$$;

revoke execute on function public.liberar_documento_do_servidor(uuid) from public, anon;
grant execute on function public.liberar_documento_do_servidor(uuid) to authenticated;

commit;
