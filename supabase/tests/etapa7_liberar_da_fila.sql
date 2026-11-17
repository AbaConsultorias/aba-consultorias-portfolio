-- Testes da Etapa 7 — liberar_documento_do_servidor (migration 20261104140000_etapa7_liberar_da_fila.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   npx.cmd supabase db query --linked -f supabase/tests/etapa7_liberar_da_fila.sql
-- Rode com o usuário postgres. Tudo acontece numa transação que termina em ROLLBACK; se alguma verificação falhar,
-- o script para com "FALHA: ..."; se chegar ao fim, imprime "OK".
-- Concorrência não dá para testar numa sessão: aqui se testa a regra (fila, ignorado, versão mais nova, permissão);
-- o lock da família cobre a corrida.
--
-- Fixture (ids com prefixo 74000000-...): cliente c1, equipe e1; empreendimento e01.
--   Família F: v1 (d001) → v2 (d002) → v3 (d003), todas do servidor; v3 liberada.
--   d010: do servidor, ignorado. d020: enviado à mão (sem origem). d030: do servidor, sozinho.

begin;

insert into auth.users (id, aud, role, email)
values
  ('74000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e7l-cliente@example.com'),
  ('74000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e7l-equipe@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('74000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E7l', true, false),
  ('74000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste E7l', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['74000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome) values ('74000000-0000-0000-0000-000000000e01', 'Empreendimento Teste E7l');

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente, grupo, criado_em)
values
  ('74000000-0000-0000-0000-00000000d001', '74000000-0000-0000-0000-000000000e01', 'Planta', '74000000-0000-0000-0000-000000000e01/d001.pdf', 'application/pdf', 100, repeat('1', 64), false, 'contratos', now() - interval '3 hours'),
  ('74000000-0000-0000-0000-00000000d010', '74000000-0000-0000-0000-000000000e01', 'Ignorado', '74000000-0000-0000-0000-000000000e01/d010.pdf', 'application/pdf', 100, repeat('4', 64), false, 'contratos', now()),
  ('74000000-0000-0000-0000-00000000d020', '74000000-0000-0000-0000-000000000e01', 'À mão', '74000000-0000-0000-0000-000000000e01/d020.pdf', 'application/pdf', 100, repeat('5', 64), false, 'contratos', now()),
  ('74000000-0000-0000-0000-00000000d030', '74000000-0000-0000-0000-000000000e01', 'Sozinho', '74000000-0000-0000-0000-000000000e01/d030.pdf', 'application/pdf', 100, repeat('6', 64), false, 'contratos', now());
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente, grupo, substitui_id, criado_em)
values ('74000000-0000-0000-0000-00000000d002', '74000000-0000-0000-0000-000000000e01', 'Planta', '74000000-0000-0000-0000-000000000e01/d002.pdf', 'application/pdf', 100, repeat('2', 64), false, 'contratos', '74000000-0000-0000-0000-00000000d001', now() - interval '2 hours');
insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente, grupo, substitui_id, criado_em)
values ('74000000-0000-0000-0000-00000000d003', '74000000-0000-0000-0000-000000000e01', 'Planta', '74000000-0000-0000-0000-000000000e01/d003.pdf', 'application/pdf', 100, repeat('3', 64), true, 'contratos', '74000000-0000-0000-0000-00000000d002', now() - interval '1 hour');

insert into public.documento_origens (documento_id, caminho_relativo, tamanho, sha256, ignorado_em)
values
  ('74000000-0000-0000-0000-00000000d001', 'x/planta.pdf', 100, repeat('1', 64), null),
  ('74000000-0000-0000-0000-00000000d002', 'x/planta.pdf', 100, repeat('2', 64), null),
  ('74000000-0000-0000-0000-00000000d003', 'x/planta.pdf', 100, repeat('3', 64), null),
  ('74000000-0000-0000-0000-00000000d010', 'x/ignorado.pdf', 100, repeat('4', 64), now()),
  ('74000000-0000-0000-0000-00000000d030', 'x/sozinho.pdf', 100, repeat('6', 64), null);

do $$
begin
  if (select familia_id from public.documentos where id = '74000000-0000-0000-0000-00000000d003') <> '74000000-0000-0000-0000-00000000d001' then
    raise exception 'FALHA: fixture sem a família esperada';
  end if;
end $$;

-- Cliente: sem permissão.
set local role authenticated;
set local request.jwt.claims = '{"sub":"74000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$
begin
  perform public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d030');
  raise exception 'FALHA: cliente liberou documento';
exception when insufficient_privilege then null;
end $$;

-- Equipe.
set local request.jwt.claims = '{"sub":"74000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
declare v text;
begin
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d002');
  if v <> 'versao_mais_nova' then raise exception 'FALHA: v2 com v3 existente deveria ser recusada, veio %', v; end if;
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d010');
  if v <> 'fora_da_fila' then raise exception 'FALHA: ignorado deveria ficar fora da fila, veio %', v; end if;
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d020');
  if v <> 'fora_da_fila' then raise exception 'FALHA: documento sem origem deveria ficar fora da fila, veio %', v; end if;
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-000000000bad');
  if v <> 'fora_da_fila' then raise exception 'FALHA: documento inexistente, veio %', v; end if;
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d003');
  if v <> 'ja_liberado' then raise exception 'FALHA: v3 já liberada, veio %', v; end if;
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d030');
  if v <> 'liberado' then raise exception 'FALHA: documento elegível não foi liberado, veio %', v; end if;
end $$;

-- Apagar a versão intermediária (v2) não faz a v1 voltar a ser liberável.
reset role;
delete from public.documentos where id = '74000000-0000-0000-0000-00000000d002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"74000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
declare v text;
begin
  v := public.liberar_documento_do_servidor('74000000-0000-0000-0000-00000000d001');
  if v <> 'versao_mais_nova' then raise exception 'FALHA: v1 com v3 na família deveria ser recusada, veio %', v; end if;
end $$;

reset role;
do $$
begin
  if not (select liberado_cliente from public.documentos where id = '74000000-0000-0000-0000-00000000d003') then
    raise exception 'FALHA: v3 deixou de estar liberada';
  end if;
  if (select liberado_cliente from public.documentos where id = '74000000-0000-0000-0000-00000000d001') then
    raise exception 'FALHA: v1 foi liberada';
  end if;
  if not (select liberado_cliente from public.documentos where id = '74000000-0000-0000-0000-00000000d030') then
    raise exception 'FALHA: d030 não ficou liberado';
  end if;
  if has_function_privilege('anon', 'public.liberar_documento_do_servidor(uuid)', 'execute') then
    raise exception 'FALHA: anon pode executar liberar_documento_do_servidor';
  end if;
end $$;

select 'OK: liberar da fila do servidor passou nos testes' as resultado;

rollback;
