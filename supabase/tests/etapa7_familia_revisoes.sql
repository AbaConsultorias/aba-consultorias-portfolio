-- Testes da Etapa 7 — família de revisões (migration 20261103110000_etapa7_familia_revisoes.sql).
-- Como rodar: npx.cmd supabase db query --linked -f supabase/tests/etapa7_familia_revisoes.sql
-- Tudo dentro de uma transação que termina em ROLLBACK; falha para com "FALHA: ...", sucesso imprime "OK".
-- A serialização entre transações concorrentes (lock por família) não dá para testar numa sessão só.
--
-- Fixture (ids com prefixo 72000000-...): empreendimento e01 com cliente c1 e equipe e1;
--   cadeia f001 (oculto) <- f002 (oculto) <- f003 (liberado); f010 sem relação, liberado.

begin;

insert into auth.users (id, aud, role, email)
values
  ('72000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e7f-cliente@example.com'),
  ('72000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e7f-equipe@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('72000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E7F', true, false),
  ('72000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste E7F', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['72000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome)
values ('72000000-0000-0000-0000-000000000e01', 'Empreendimento Teste E7F');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('72000000-0000-0000-0000-000000000e01', '72000000-0000-0000-0000-0000000000c1');

-- familia_id enviado no INSERT é ignorado: vem da versão substituída.
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente, substitui_id, familia_id)
values
  ('72000000-0000-0000-0000-00000000f001', '72000000-0000-0000-0000-000000000e01', 'Versão 1',
   '72000000-0000-0000-0000-000000000e01/72000000-0000-0000-0000-00000000f001.pdf', 'application/pdf', 100, false, null,
   '72000000-0000-0000-0000-00000000f010'),
  ('72000000-0000-0000-0000-00000000f010', '72000000-0000-0000-0000-000000000e01', 'Sem relação',
   '72000000-0000-0000-0000-000000000e01/72000000-0000-0000-0000-00000000f010.pdf', 'application/pdf', 100, true, null, null);
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente, substitui_id, familia_id)
values ('72000000-0000-0000-0000-00000000f002', '72000000-0000-0000-0000-000000000e01', 'Versão 2',
        '72000000-0000-0000-0000-000000000e01/72000000-0000-0000-0000-00000000f002.pdf', 'application/pdf', 100, false,
        '72000000-0000-0000-0000-00000000f001', '72000000-0000-0000-0000-00000000f010');
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, liberado_cliente, substitui_id)
values ('72000000-0000-0000-0000-00000000f003', '72000000-0000-0000-0000-000000000e01', 'Versão 3',
        '72000000-0000-0000-0000-000000000e01/72000000-0000-0000-0000-00000000f003.pdf', 'application/pdf', 100, true,
        '72000000-0000-0000-0000-00000000f002');

do $$
begin
  if (select count(*) from public.documentos
       where familia_id = '72000000-0000-0000-0000-00000000f001') <> 3 then
    raise exception 'FALHA: as três versões deveriam ter a família da v1';
  end if;
  if (select familia_id from public.documentos where id = '72000000-0000-0000-0000-00000000f010')
     is distinct from '72000000-0000-0000-0000-00000000f010'::uuid then
    raise exception 'FALHA: documento sem relação deveria ser a própria família';
  end if;
  begin
    update public.documentos set familia_id = '72000000-0000-0000-0000-00000000f010'
     where id = '72000000-0000-0000-0000-00000000f003';
    raise exception 'FALHA: familia_id foi alterado';
  exception when check_violation then
    null;
  end;

  -- Apagar a versão do meio não separa a família.
  delete from public.documentos where id = '72000000-0000-0000-0000-00000000f002';
  if (select substitui_id from public.documentos where id = '72000000-0000-0000-0000-00000000f003') is not null then
    raise exception 'FALHA: a v3 deveria ter perdido o substitui_id';
  end if;

  -- Liberar a v1 por UPDATE direto oculta a v3, mesmo sem cadeia substitui_id.
  update public.documentos set liberado_cliente = true where id = '72000000-0000-0000-0000-00000000f001';
  if (select liberado_cliente from public.documentos where id = '72000000-0000-0000-0000-00000000f003') then
    raise exception 'FALHA: v1 e v3 ficaram liberadas ao mesmo tempo depois de apagar a v2';
  end if;
  if not (select liberado_cliente from public.documentos where id = '72000000-0000-0000-0000-00000000f010') then
    raise exception 'FALHA: documento sem relação foi ocultado';
  end if;
end $$;

-- Equipe: a v3 continua sendo revisão para a função, mesmo sem substitui_id.
set local role authenticated;
set local request.jwt.claims = '{"sub":"72000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
begin
  perform public.liberar_revisao_documento('72000000-0000-0000-0000-00000000f003');
  if not (select liberado_cliente from public.documentos where id = '72000000-0000-0000-0000-00000000f003')
     or (select liberado_cliente from public.documentos where id = '72000000-0000-0000-0000-00000000f001') then
    raise exception 'FALHA: liberar a v3 deveria ocultar a v1';
  end if;
  begin
    perform public.liberar_revisao_documento('72000000-0000-0000-0000-00000000f010');
    raise exception 'FALHA: documento sem família aceito como revisão';
  exception when check_violation then
    null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"72000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select array_agg(id order by id) from public.documentos where id::text like '72000000%')
     is distinct from array['72000000-0000-0000-0000-00000000f003', '72000000-0000-0000-0000-00000000f010']::uuid[] then
    raise exception 'FALHA: cliente deveria ver só a v3 e o documento sem relação';
  end if;
end $$;

select 'OK: família de revisões da Etapa 7 passou nos testes' as resultado;

rollback;
