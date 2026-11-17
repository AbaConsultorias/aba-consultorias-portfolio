-- Testes da Etapa 7, frente C — colunas de conector_envios usadas pela API (migration 20261104100000_etapa7_envios.sql).
-- Como rodar: depois de aplicar TODAS as migrations, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa7_envios.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa7_envios.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids com prefixo 71000000-...):
--   empreendimento A (e01); cliente de A (c1), empreiteiro (b1); conector (c01).

begin;

-- O banco aceita um só conector ativo, e o de produção já existe. Revogá-lo aqui vale só dentro
-- desta transação, que termina em ROLLBACK: o conector real não é afetado.
update public.conectores set revogado_em = now() where revogado_em is null;

insert into auth.users (id, aud, role, email)
values
  ('71000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e7env-cliente@example.com'),
  ('71000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e7env-empreiteiro@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('71000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E7 Envios', true, false),
  ('71000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste E7 Envios', true, false);

insert into public.empreendimentos (id, nome, codigo_pasta)
values ('71000000-0000-0000-0000-000000000e01', 'Empreendimento A Teste E7 Envios', '222222');

insert into public.empreendimento_clientes (empreendimento_id, profile_id)
values ('71000000-0000-0000-0000-000000000e01', '71000000-0000-0000-0000-0000000000c1');

insert into public.conectores (id, nome, token_hash)
values ('71000000-0000-0000-0000-000000000c01', 'Conector teste envios', repeat('b', 64));

-- ---------------------------------------------------------------------------
-- Estrutura e restrições (como postgres, que ignora o RLS mas não os CHECK/UNIQUE).
-- ---------------------------------------------------------------------------

do $$
declare
  v_coluna text;
  v_indice text;
begin
  foreach v_coluna in array array['storage_path', 'documento_planejado_id', 'mtime', 'confirmado_em'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conector_envios' and column_name = v_coluna
    ) then
      raise exception 'FALHA: coluna % ausente em conector_envios', v_coluna;
    end if;
  end loop;

  -- Índice do último envio confirmado por caminho: sem diferenciar caixa e só dos confirmados.
  select indexdef into v_indice from pg_indexes
   where schemaname = 'public' and indexname = 'conector_envios_caminho_confirmado_idx';
  if v_indice is null or v_indice not like '%lower(caminho_relativo)%' or v_indice not like '%WHERE%confirmado%' then
    raise exception 'FALHA: índice do último envio confirmado ausente ou diferente do esperado: %', v_indice;
  end if;

  -- Chave planejada coerente com o empreendimento e com o id planejado.
  insert into public.conector_envios (id, conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                      storage_path, documento_planejado_id, mtime)
  values ('71000000-0000-0000-0000-00000000f001', '71000000-0000-0000-0000-000000000c01',
          '71000000-0000-0000-0000-000000000e01', '03 - PRODUTOS/LAN/PLANTA.pdf', 100, repeat('1', 64), 'autorizado',
          '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d001.pdf',
          '71000000-0000-0000-0000-00000000d001', now());

  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                        storage_path, documento_planejado_id)
    values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'outro.pdf', 100,
            repeat('2', 64), 'autorizado',
            '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d999.pdf',
            '71000000-0000-0000-0000-00000000d002');
    raise exception 'FALHA: storage_path diferente do id planejado aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                        storage_path, documento_planejado_id)
    values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'outro.pdf', 100,
            repeat('2', 64), 'autorizado',
            '71000000-0000-0000-0000-000000000e02/71000000-0000-0000-0000-00000000d002.pdf',
            '71000000-0000-0000-0000-00000000d002');
    raise exception 'FALHA: storage_path de outro empreendimento aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                        storage_path)
    values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'outro.pdf', 100,
            repeat('2', 64), 'autorizado',
            '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d002.pdf');
    raise exception 'FALHA: storage_path sem documento_planejado_id aceito';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                        documento_planejado_id)
    values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'outro.pdf', 100,
            repeat('2', 64), 'autorizado', '71000000-0000-0000-0000-00000000d002');
    raise exception 'FALHA: documento_planejado_id sem storage_path aceito';
  exception when check_violation then
    null;
  end;

  foreach v_coluna in array array[
    '../x.pdf', 'x.pdf', '71000000-0000-0000-0000-000000000e01/x.pdf',
    '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d002.PDF',
    '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d002.pdf/'
  ] loop
    begin
      insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                          storage_path, documento_planejado_id)
      values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'outro.pdf', 100,
              repeat('2', 64), 'autorizado', v_coluna, '71000000-0000-0000-0000-00000000d002');
      raise exception 'FALHA: storage_path malformado aceito: [%]', v_coluna;
    exception when check_violation then
      null;
    end;
  end loop;

  -- Linhas sem planejamento (recusado, duplicado) continuam valendo: ambos os campos nulos.
  insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado, erro)
  values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'x/bloqueado.pdf', 5,
          repeat('3', 64), 'recusado', 'Caminho bloqueado.');

  -- O id planejado nunca se repete.
  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                        storage_path, documento_planejado_id)
    values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'outro.pdf', 100,
            repeat('4', 64), 'autorizado',
            '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d001.pdf',
            '71000000-0000-0000-0000-00000000d001');
    raise exception 'FALHA: documento_planejado_id repetido aceito';
  exception when unique_violation then
    null;
  end;

  -- confirmado_em só existe em envio confirmado.
  begin
    update public.conector_envios set confirmado_em = now() where id = '71000000-0000-0000-0000-00000000f001';
    raise exception 'FALHA: confirmado_em aceito em envio autorizado';
  exception when check_violation then
    null;
  end;

  update public.conector_envios set estado = 'confirmado', confirmado_em = now()
   where id = '71000000-0000-0000-0000-00000000f001';

  -- A unicidade de conteúdo confirmado por empreendimento continua valendo (corrida do confirmar).
  insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256, estado,
                                      storage_path, documento_planejado_id)
  values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'copia/PLANTA.pdf', 100,
          repeat('1', 64), 'autorizado',
          '71000000-0000-0000-0000-000000000e01/71000000-0000-0000-0000-00000000d003.pdf',
          '71000000-0000-0000-0000-00000000d003');
  begin
    update public.conector_envios set estado = 'confirmado', confirmado_em = now()
     where documento_planejado_id = '71000000-0000-0000-0000-00000000d003';
    raise exception 'FALHA: mesmo sha256 confirmado duas vezes no empreendimento';
  exception when unique_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Cliente e empreiteiro: nada de conector_envios.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.conector_envios) <> 0 then
    raise exception 'FALHA: cliente lê conector_envios';
  end if;
  begin
    insert into public.conector_envios (conector_id, empreendimento_id, caminho_relativo, tamanho, sha256)
    values ('71000000-0000-0000-0000-000000000c01', '71000000-0000-0000-0000-000000000e01', 'cliente.pdf', 1, repeat('9', 64));
    raise exception 'FALHA: cliente gravou conector_envios';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.conector_envios set storage_path = null;
    raise exception 'FALHA: cliente alterou conector_envios';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.conector_envios) <> 0 then
    raise exception 'FALHA: empreiteiro lê conector_envios';
  end if;
  begin
    delete from public.conector_envios;
    raise exception 'FALHA: empreiteiro apagou conector_envios';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform storage_path from public.conector_envios;
    raise exception 'FALHA: anon leu conector_envios';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: colunas de envio do conector da Etapa 7 passaram nos testes' as resultado;

rollback;
