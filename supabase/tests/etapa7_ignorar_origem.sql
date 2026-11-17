-- Testes da Etapa 7 — "Ignorar" na fila do servidor (migration 20261104130000_etapa7_ignorar_origem.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   npx.cmd supabase db query --linked -f supabase/tests/etapa7_ignorar_origem.sql
-- Rode com o usuário postgres. Tudo acontece numa transação que termina em ROLLBACK; se alguma verificação falhar,
-- o script para com "FALHA: ..."; se chegar ao fim, imprime "OK".
--
-- Fixture (ids com prefixo 73000000-...): cliente c1, equipe e1; empreendimento e01 com o cliente; documento d001
-- oculto com origem o001.

begin;

insert into auth.users (id, aud, role, email)
values
  ('73000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e7i-cliente@example.com'),
  ('73000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e7i-equipe@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('73000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E7i', true, false),
  ('73000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe Teste E7i', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['73000000-0000-0000-0000-0000000000e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

insert into public.empreendimentos (id, nome) values ('73000000-0000-0000-0000-000000000e01', 'Empreendimento Teste E7i');
insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('73000000-0000-0000-0000-000000000e01', '73000000-0000-0000-0000-0000000000c1');

insert into public.documentos (id, empreendimento_id, titulo, storage_path, mime, tamanho, sha256, liberado_cliente, grupo)
values ('73000000-0000-0000-0000-00000000d001', '73000000-0000-0000-0000-000000000e01', 'Documento E7i',
        '73000000-0000-0000-0000-000000000e01/73000000-0000-0000-0000-00000000d001.pdf', 'application/pdf', 100,
        repeat('b', 64), false, 'contratos');

insert into public.documento_origens (id, documento_id, caminho_relativo, tamanho, sha256)
values ('73000000-0000-0000-0000-00000000a001', '73000000-0000-0000-0000-00000000d001', 'x/doc.pdf', 100, repeat('b', 64));

-- Cliente: não vê a origem nem consegue marcar.
set local role authenticated;
set local request.jwt.claims = '{"sub":"73000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
do $$
declare v_n integer;
begin
  update public.documento_origens set ignorado_em = now() where id = '73000000-0000-0000-0000-00000000a001';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FALHA: cliente marcou origem como ignorada'; end if;
end $$;

-- Equipe: marca; o banco carimba data e autor, ignorando o que veio do navegador.
set local request.jwt.claims = '{"sub":"73000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
do $$
declare v_n integer;
begin
  update public.documento_origens set ignorado_em = '2000-01-01' where id = '73000000-0000-0000-0000-00000000a001';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FALHA: equipe não conseguiu marcar origem como ignorada'; end if;

  -- Só ignorado_em é gravável: qualquer outra coluna é recusada pelo privilégio.
  begin
    update public.documento_origens set caminho_relativo = 'y/outro.pdf' where id = '73000000-0000-0000-0000-00000000a001';
    raise exception 'FALHA: equipe alterou caminho_relativo';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.documento_origens set ignorado_por = '73000000-0000-0000-0000-0000000000c1' where id = '73000000-0000-0000-0000-00000000a001';
    raise exception 'FALHA: equipe gravou ignorado_por';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if (select ignorado_em < now() - interval '1 minute' or ignorado_por is distinct from '73000000-0000-0000-0000-0000000000e1'
        from public.documento_origens where id = '73000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: ignorado_em/ignorado_por não foram carimbados pelo banco';
  end if;
  if (select liberado_cliente from public.documentos where id = '73000000-0000-0000-0000-00000000d001') then
    raise exception 'FALHA: ignorar não pode liberar o documento';
  end if;
end $$;

-- Desfazer limpa o autor.
set local role authenticated;
set local request.jwt.claims = '{"sub":"73000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
update public.documento_origens set ignorado_em = null where id = '73000000-0000-0000-0000-00000000a001';
reset role;
do $$
begin
  if (select ignorado_em is not null or ignorado_por is not null from public.documento_origens
        where id = '73000000-0000-0000-0000-00000000a001') then
    raise exception 'FALHA: desfazer não limpou ignorado_em/ignorado_por';
  end if;
end $$;

select 'OK: ignorar na fila do servidor passou nos testes' as resultado;

rollback;
