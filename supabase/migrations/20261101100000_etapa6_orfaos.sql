-- Etapa 6: lista de objetos órfãos do Storage (envio assinado nunca confirmado).
-- Referência = qualquer coluna text `*_path` de public (montada na hora, então
-- colunas novas entram sozinhas). A remoção é feita pela API do Storage, nunca
-- por SQL; esta função só lista. EXECUTE apenas para service_role.
begin;

create or replace function public.listar_objetos_orfaos(
  p_bucket text,
  p_idade interval default '24 hours',
  p_limite int default 500
)
returns table (nome text, criado_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refs text;
begin
  if p_bucket is null or p_bucket not in ('site-publico', 'documentos', 'obras', 'fornecedores') then
    raise exception 'bucket inválido' using errcode = '23514';
  end if;
  if p_idade is null or p_idade < interval '1 hour' then
    raise exception 'idade mínima de 1 hora' using errcode = '23514';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 1000 then
    raise exception 'limite entre 1 e 1000' using errcode = '23514';
  end if;

  select string_agg(
           format('select %I as caminho from public.%I where %I is not null',
                  c.column_name, c.table_name, c.column_name),
           ' union all ')
    into v_refs
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and c.column_name like '%\_path' escape '\'
     and c.data_type = 'text';

  if v_refs is null then
    raise exception 'nenhuma coluna de caminho encontrada' using errcode = 'P0002';
  end if;

  return query execute format(
    'select o.name, o.created_at
       from storage.objects o
      where o.bucket_id = $1
        and o.created_at < now() - $2
        and not exists (select 1 from (%s) r where r.caminho = o.name)
      order by o.created_at
      limit $3',
    v_refs)
  using p_bucket, p_idade, p_limite;
end;
$$;

revoke execute on function public.listar_objetos_orfaos(text, interval, int) from public, anon, authenticated;
grant execute on function public.listar_objetos_orfaos(text, interval, int) to service_role;

commit;
