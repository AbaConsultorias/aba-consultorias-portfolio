-- Testes da Etapa 6: listar_objetos_orfaos.
-- Como rodar: depois de aplicar 20261101100000, use
--   npx.cmd supabase db query --linked -f supabase/tests/etapa6_orfaos.sql
-- Tudo dentro de uma transação que termina em ROLLBACK. Falha = "FALHA: ...".
--
-- Fixture: três objetos antigos no bucket obras (um referenciado por
-- atualizacao_fotos via empreendimento/atualização de teste, dois soltos) e um
-- objeto solto recente, que não pode aparecer (ainda pode estar sendo enviado).

begin;

insert into public.empreendimentos (id, nome, cidade)
values ('60000000-0000-0000-0000-0000000000e1', '[TESTE] e6 órfãos', 'Caratinga');

insert into public.atualizacoes (id, empreendimento_id, titulo, texto, data_visita, publicado)
values ('60000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000e1',
        'teste', 'teste', current_date, false);

insert into storage.objects (id, bucket_id, name, created_at)
values
  (gen_random_uuid(), 'obras', 'atualizacoes/60000000-0000-0000-0000-0000000000e1/60000000-0000-0000-0000-0000000000a1/60000000-0000-0000-0000-0000000000f1.jpg', now() - interval '3 days'),
  (gen_random_uuid(), 'obras', 'atualizacoes/60000000-0000-0000-0000-0000000000e1/60000000-0000-0000-0000-0000000000a1/60000000-0000-0000-0000-0000000000f2.jpg', now() - interval '3 days'),
  (gen_random_uuid(), 'obras', 'relatos/60000000-0000-0000-0000-0000000000e1/x/60000000-0000-0000-0000-0000000000f3.jpg', now() - interval '2 days'),
  (gen_random_uuid(), 'obras', 'relatos/60000000-0000-0000-0000-0000000000e1/x/60000000-0000-0000-0000-0000000000f4.jpg', now() - interval '10 minutes');

insert into public.atualizacao_fotos (atualizacao_id, storage_path, mime, tamanho, ordem)
values ('60000000-0000-0000-0000-0000000000a1',
        'atualizacoes/60000000-0000-0000-0000-0000000000e1/60000000-0000-0000-0000-0000000000a1/60000000-0000-0000-0000-0000000000f1.jpg',
        'image/jpeg', 1000, 1);

do $$
declare
  v_nomes text[];
begin
  select array_agg(nome order by nome) into v_nomes
    from public.listar_objetos_orfaos('obras', interval '1 day', 1000)
   where nome like '%60000000-0000-0000-0000-0000000000f%';

  if v_nomes is distinct from array[
       'atualizacoes/60000000-0000-0000-0000-0000000000e1/60000000-0000-0000-0000-0000000000a1/60000000-0000-0000-0000-0000000000f2.jpg',
       'relatos/60000000-0000-0000-0000-0000000000e1/x/60000000-0000-0000-0000-0000000000f3.jpg'] then
    raise exception 'FALHA: órfãos esperados f2 e f3, veio %', v_nomes;
  end if;

  begin
    perform * from public.listar_objetos_orfaos('outro', interval '1 day', 10);
    raise exception 'FALHA: bucket inválido aceito';
  exception when sqlstate '23514' then null;
  end;

  begin
    perform * from public.listar_objetos_orfaos('obras', interval '5 minutes', 10);
    raise exception 'FALHA: idade abaixo de 1 hora aceita';
  exception when sqlstate '23514' then null;
  end;

  if has_function_privilege('anon', 'public.listar_objetos_orfaos(text, interval, int)', 'execute')
     or has_function_privilege('authenticated', 'public.listar_objetos_orfaos(text, interval, int)', 'execute') then
    raise exception 'FALHA: anon/authenticated podem executar listar_objetos_orfaos';
  end if;
  if not has_function_privilege('service_role', 'public.listar_objetos_orfaos(text, interval, int)', 'execute') then
    raise exception 'FALHA: service_role não executa listar_objetos_orfaos';
  end if;
end $$;

select 'OK: listar_objetos_orfaos da Etapa 6 passou' as resultado;

rollback;
