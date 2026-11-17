-- Testes da Etapa 8, onda 1 — base das permissões: catálogo, equipe_permissoes, tem_permissao e minhas_permissoes.
-- Como rodar: depois de aplicar TODAS as migrations, incluindo 20261105100000_etapa8_permissoes.sql, use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa8_permissoes.sql
-- (ou npx.cmd supabase db query --linked -f supabase/tests/etapa8_permissoes.sql)
-- Rode com o usuário postgres, em banco de teste. Tudo acontece dentro de uma transação que termina em
-- ROLLBACK, então nada fica no banco. Se alguma verificação falhar, o script para com "FALHA: ...";
-- se chegar ao fim, imprime "OK" no último select.
--
-- Fixture (ids com prefixo 80000000-...; o sufixo mostra o papel):
--   admins: a1 (ativo), a2 (inativo), a3 (ativo, só concede uma permissão e é apagado);
--   equipe: e1 (ativa; site.ver, site.editar, financeiro.ver), e2 (inativa; site.ver),
--           e3 (troca de senha pendente; site.ver), e4 (ativa; as 22), e5 (ativa; sem linhas, alvo do admin),
--           e6 (ativa; sem linhas, alvo das restrições), e7 (ativa; descartável, apagada com linhas em cadeia);
--   cliente c1, empreiteiro b1, fornecedor f1 (sem linhas);
--   d1, d2, d3: foram equipe com site.ver e viraram cliente, empreiteiro e fornecedor (linha velha que não vale).

begin;

insert into auth.users (id, aud, role, email)
values
  ('80000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'e8-admin@example.com'),
  ('80000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'e8-admin-inativo@example.com'),
  ('80000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', 'e8-admin-descartavel@example.com'),
  ('80000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'e8-equipe1@example.com'),
  ('80000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'e8-equipe2@example.com'),
  ('80000000-0000-0000-0000-0000000000e3', 'authenticated', 'authenticated', 'e8-equipe3@example.com'),
  ('80000000-0000-0000-0000-0000000000e4', 'authenticated', 'authenticated', 'e8-equipe4@example.com'),
  ('80000000-0000-0000-0000-0000000000e5', 'authenticated', 'authenticated', 'e8-equipe5@example.com'),
  ('80000000-0000-0000-0000-0000000000e6', 'authenticated', 'authenticated', 'e8-equipe6@example.com'),
  ('80000000-0000-0000-0000-0000000000e7', 'authenticated', 'authenticated', 'e8-equipe7@example.com'),
  ('80000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'e8-cliente@example.com'),
  ('80000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'e8-empreiteiro@example.com'),
  ('80000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'e8-fornecedor@example.com'),
  ('80000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'e8-velho-cliente@example.com'),
  ('80000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'e8-velho-empreiteiro@example.com'),
  ('80000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'e8-velho-fornecedor@example.com');

-- Os "velhos" (d1, d2, d3) nascem equipe para receber a linha e mudam de papel logo depois.
insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('80000000-0000-0000-0000-0000000000a1', 'admin', 'Admin Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000a2', 'admin', 'Admin Inativo Teste E8', false, false),
  ('80000000-0000-0000-0000-0000000000a3', 'admin', 'Admin Descartável Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000e1', 'equipe', 'Equipe 1 Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000e2', 'equipe', 'Equipe 2 Inativa Teste E8', false, false),
  ('80000000-0000-0000-0000-0000000000e3', 'equipe', 'Equipe 3 Troca Pendente Teste E8', true, true),
  ('80000000-0000-0000-0000-0000000000e4', 'equipe', 'Equipe 4 Completa Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000e5', 'equipe', 'Equipe 5 Alvo Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000e6', 'equipe', 'Equipe 6 Restrições Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000e7', 'equipe', 'Equipe 7 Descartável Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000c1', 'cliente', 'Cliente Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000b1', 'empreiteiro', 'Empreiteiro Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000f1', 'fornecedor', 'Fornecedor Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000d1', 'equipe', 'Velho Cliente Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000d2', 'equipe', 'Velho Empreiteiro Teste E8', true, false),
  ('80000000-0000-0000-0000-0000000000d3', 'equipe', 'Velho Fornecedor Teste E8', true, false);

-- Linhas da fixture, gravadas como postgres (concedida_por fica null: não há sessão).
-- Em cada perfil, o pré-requisito entra antes de quem depende dele.
insert into public.equipe_permissoes (profile_id, permissao)
values
  ('80000000-0000-0000-0000-0000000000e1', 'site.ver'),
  ('80000000-0000-0000-0000-0000000000e1', 'site.editar'),
  ('80000000-0000-0000-0000-0000000000e1', 'financeiro.ver'),
  ('80000000-0000-0000-0000-0000000000e2', 'site.ver'),
  ('80000000-0000-0000-0000-0000000000e3', 'site.ver'),
  ('80000000-0000-0000-0000-0000000000d1', 'site.ver'),
  ('80000000-0000-0000-0000-0000000000d2', 'site.ver'),
  ('80000000-0000-0000-0000-0000000000d3', 'site.ver');

do $$
declare
  v_permissao text;
begin
  foreach v_permissao in array public.catalogo_permissoes() loop
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e4', v_permissao);
  end loop;
end $$;

update public.profiles set papel = 'cliente' where id = '80000000-0000-0000-0000-0000000000d1';
update public.profiles set papel = 'empreiteiro' where id = '80000000-0000-0000-0000-0000000000d2';
update public.profiles set papel = 'fornecedor' where id = '80000000-0000-0000-0000-0000000000d3';

-- ---------------------------------------------------------------------------
-- Estrutura, catálogo, restrições e triggers (como postgres, que ignora o RLS mas não CHECK/UNIQUE/triggers).
-- ---------------------------------------------------------------------------

do $$
declare
  v_permissao text;
  v_esperado text[];
  v_constraint text;
  v_catalogo text[];
begin
  v_catalogo := public.catalogo_permissoes();

  -- Catálogo: exatamente as 24 (as 22 originais mais empreendimentos.excluir e fornecedores.excluir).
  if cardinality(v_catalogo) <> 24 or (select count(distinct x) from unnest(v_catalogo) as x) <> 24 then
    raise exception 'FALHA: o catálogo deveria ter exatamente 24 permissões distintas';
  end if;
  if (select array_agg(x order by x) from unnest(v_catalogo) as x) is distinct from (
    select array_agg(x order by x) from unnest(array[
      'site.ver', 'site.editar', 'contatos.ver', 'contatos.editar', 'empreendimentos.ver', 'empreendimentos.editar',
      'empreendimentos.excluir', 'clientes.ver', 'clientes.editar', 'atualizacoes.ver', 'atualizacoes.editar', 'documentos.ver', 'documentos.editar',
      'documentos.liberar', 'financeiro.ver', 'financeiro.editar', 'obras.ver', 'obras.editar', 'obras.aprovar',
      'fornecedores.ver', 'fornecedores.editar', 'fornecedores.excluir', 'servidor.regras', 'painel.servidor'
    ]) as x
  ) then
    raise exception 'FALHA: o catálogo não é a lista combinada no contrato';
  end if;

  -- Segurança da tabela.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.equipe_permissoes'::regclass) then
    raise exception 'FALHA: RLS desligado em equipe_permissoes';
  end if;
  if has_table_privilege('anon', 'public.equipe_permissoes', 'select')
     or has_table_privilege('anon', 'public.equipe_permissoes', 'insert')
     or has_table_privilege('anon', 'public.equipe_permissoes', 'delete')
     or has_table_privilege('anon', 'public.equipe_permissoes', 'update') then
    raise exception 'FALHA: anon tem privilégio em equipe_permissoes';
  end if;
  if has_table_privilege('authenticated', 'public.equipe_permissoes', 'update')
     or has_any_column_privilege('authenticated', 'public.equipe_permissoes', 'update') then
    raise exception 'FALHA: authenticated tem UPDATE em equipe_permissoes';
  end if;
  if not (has_table_privilege('authenticated', 'public.equipe_permissoes', 'select')
          and has_table_privilege('authenticated', 'public.equipe_permissoes', 'insert')
          and has_table_privilege('authenticated', 'public.equipe_permissoes', 'delete')) then
    raise exception 'FALHA: authenticated deveria ter SELECT, INSERT e DELETE em equipe_permissoes (o RLS separa o admin)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'equipe_permissoes') <> 3 then
    raise exception 'FALHA: equipe_permissoes deveria ter exatamente 3 políticas (select, insert, delete)';
  end if;

  -- Pré-requisitos, conferidos contra a regra escrita de outro jeito.
  foreach v_permissao in array v_catalogo loop
    if v_permissao like '%.editar' then
      v_esperado := array[replace(v_permissao, '.editar', '.ver')];
    elsif v_permissao = 'documentos.liberar' then
      v_esperado := array['documentos.ver'];
    elsif v_permissao = 'obras.aprovar' then
      v_esperado := array['obras.ver'];
    elsif v_permissao = 'servidor.regras' then
      v_esperado := array['empreendimentos.ver'];
    elsif v_permissao like '%.excluir' then
      v_esperado := array[replace(v_permissao, '.excluir', '.editar')];
    else
      v_esperado := array[]::text[];
    end if;
    if public.prerequisitos_permissao(v_permissao) is distinct from v_esperado then
      raise exception 'FALHA: pré-requisitos de % deveriam ser %, vieram %',
        v_permissao, v_esperado, public.prerequisitos_permissao(v_permissao);
    end if;
  end loop;
  if public.prerequisitos_permissao('nao.existe') is distinct from array[]::text[]
     or public.prerequisitos_permissao(null) is distinct from array[]::text[] then
    raise exception 'FALHA: permissão desconhecida ou nula deveria ter pré-requisitos vazios';
  end if;

  -- Permissão fora do catálogo é recusada pelo CHECK (e não por outro motivo).
  foreach v_permissao in array array['nao.existe', 'Site.ver', 'SITE.VER', 'site.ver ', ' site.ver', '', 'site', 'site.apagar'] loop
    begin
      insert into public.equipe_permissoes (profile_id, permissao)
      values ('80000000-0000-0000-0000-0000000000e6', v_permissao);
      raise exception 'FALHA: permissão fora do catálogo aceita: [%]', v_permissao;
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'equipe_permissoes_permissao_catalogo' then
        raise exception 'FALHA: permissão fora do catálogo recusada por outro motivo ([%]): %', v_permissao, sqlerrm;
      end if;
    end;
  end loop;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', null);
    raise exception 'FALHA: permissão nula aceita';
  exception when not_null_violation then
    null;
  end;

  -- Duplicada.
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e1', 'site.ver');
    raise exception 'FALHA: permissão repetida para o mesmo perfil aceita';
  exception when unique_violation then
    null;
  end;

  -- Dependência ao conceder.
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'site.editar');
    raise exception 'FALHA: site.editar aceito sem site.ver';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'servidor.regras');
    raise exception 'FALHA: servidor.regras aceito sem empreendimentos.ver';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'documentos.liberar');
    raise exception 'FALHA: documentos.liberar aceito sem documentos.ver';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'obras.aprovar');
    raise exception 'FALHA: obras.aprovar aceito sem obras.ver';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'empreendimentos.excluir');
    raise exception 'FALHA: empreendimentos.excluir aceito sem empreendimentos.editar';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'fornecedores.excluir');
    raise exception 'FALHA: fornecedores.excluir aceito sem fornecedores.editar';
  exception when check_violation then
    null;
  end;
  begin
    -- O pré-requisito de outro perfil não vale.
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e6', 'financeiro.editar');
    raise exception 'FALHA: financeiro.editar aceito sem financeiro.ver no mesmo perfil (e1 tem financeiro.ver)';
  exception when check_violation then
    null;
  end;
  if exists (select 1 from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e6') then
    raise exception 'FALHA: tentativas recusadas deixaram linha no e6';
  end if;

  -- Dependência ao remover: site.ver não sai com site.editar presente; editar primeiro, depois ver.
  insert into public.equipe_permissoes (profile_id, permissao)
  values ('80000000-0000-0000-0000-0000000000e6', 'site.ver'),
         ('80000000-0000-0000-0000-0000000000e6', 'site.editar');
  begin
    delete from public.equipe_permissoes
     where profile_id = '80000000-0000-0000-0000-0000000000e6' and permissao = 'site.ver';
    raise exception 'FALHA: site.ver apagado com site.editar presente';
  exception when check_violation then
    null;
  end;
  if (select count(*) from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e6') <> 2 then
    raise exception 'FALHA: a remoção recusada de site.ver mexeu nas linhas';
  end if;
  delete from public.equipe_permissoes
   where profile_id = '80000000-0000-0000-0000-0000000000e6' and permissao = 'site.editar';
  delete from public.equipe_permissoes
   where profile_id = '80000000-0000-0000-0000-0000000000e6' and permissao = 'site.ver';
  if exists (select 1 from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e6') then
    raise exception 'FALHA: apagar editar e depois ver deveria esvaziar o e6';
  end if;

  -- servidor.regras depende de empreendimentos.ver, também ao remover.
  insert into public.equipe_permissoes (profile_id, permissao)
  values ('80000000-0000-0000-0000-0000000000e6', 'empreendimentos.ver'),
         ('80000000-0000-0000-0000-0000000000e6', 'servidor.regras');
  begin
    delete from public.equipe_permissoes
     where profile_id = '80000000-0000-0000-0000-0000000000e6' and permissao = 'empreendimentos.ver';
    raise exception 'FALHA: empreendimentos.ver apagado com servidor.regras presente';
  exception when check_violation then
    null;
  end;
  delete from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e6' and permissao = 'servidor.regras';
  delete from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e6' and permissao = 'empreendimentos.ver';

  -- Só equipe recebe permissão.
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000c1', 'site.ver');
    raise exception 'FALHA: permissão concedida a um cliente';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000a1', 'site.ver');
    raise exception 'FALHA: permissão concedida a um admin';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000b1', 'obras.ver');
    raise exception 'FALHA: permissão concedida a um empreiteiro';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000f1', 'fornecedores.ver');
    raise exception 'FALHA: permissão concedida a um fornecedor';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-00000000ffff', 'site.ver');
    raise exception 'FALHA: permissão concedida a um perfil que não existe';
  exception when check_violation then
    null;
  end;
  -- Conta inativa ou com troca pendente é equipe: pode ter a linha (só não vale até reativar).
  if not exists (select 1 from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e2') then
    raise exception 'FALHA: a fixture da equipe inativa deveria ter a linha';
  end if;

  -- A linha é imutável, inclusive para quem ignora o RLS.
  begin
    update public.equipe_permissoes set concedida_em = now() - interval '1 day'
     where profile_id = '80000000-0000-0000-0000-0000000000e1' and permissao = 'site.ver';
    raise exception 'FALHA: concedida_em foi alterada';
  exception when check_violation then
    null;
  end;
  begin
    update public.equipe_permissoes set permissao = 'contatos.ver'
     where profile_id = '80000000-0000-0000-0000-0000000000e1' and permissao = 'financeiro.ver';
    raise exception 'FALHA: permissao foi alterada';
  exception when check_violation then
    null;
  end;
  begin
    update public.equipe_permissoes set profile_id = '80000000-0000-0000-0000-0000000000e6'
     where profile_id = '80000000-0000-0000-0000-0000000000e1' and permissao = 'financeiro.ver';
    raise exception 'FALHA: a permissão foi passada para outro perfil';
  exception when check_violation then
    null;
  end;
  begin
    update public.equipe_permissoes set concedida_por = '80000000-0000-0000-0000-0000000000a1'
     where profile_id = '80000000-0000-0000-0000-0000000000e1' and permissao = 'financeiro.ver';
    raise exception 'FALHA: concedida_por foi alterada';
  exception when check_violation then
    null;
  end;
  begin
    update public.equipe_permissoes set id = gen_random_uuid()
     where profile_id = '80000000-0000-0000-0000-0000000000e1' and permissao = 'financeiro.ver';
    raise exception 'FALHA: id foi alterado';
  exception when check_violation then
    null;
  end;
end $$;

-- Apagar o perfil leva as permissões junto, mesmo com site.ver e site.editar (e outras dependências) presentes.
do $$
begin
  insert into public.equipe_permissoes (profile_id, permissao)
  values ('80000000-0000-0000-0000-0000000000e7', 'site.ver'),
         ('80000000-0000-0000-0000-0000000000e7', 'site.editar'),
         ('80000000-0000-0000-0000-0000000000e7', 'empreendimentos.ver'),
         ('80000000-0000-0000-0000-0000000000e7', 'servidor.regras'),
         ('80000000-0000-0000-0000-0000000000e7', 'documentos.ver'),
         ('80000000-0000-0000-0000-0000000000e7', 'documentos.liberar');
  if (select count(*) from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e7') <> 6 then
    raise exception 'FALHA: o e7 deveria ter 6 linhas antes de ser apagado';
  end if;

  delete from public.profiles where id = '80000000-0000-0000-0000-0000000000e7';

  if exists (select 1 from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e7') then
    raise exception 'FALHA: permissões do perfil apagado ficaram no banco';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- tem_permissao e minhas_permissoes por sessão.
-- ---------------------------------------------------------------------------

do $$
declare
  v_caso record;
  v_ver boolean;
  v_contatos boolean;
  v_inexistente boolean;
  v_nula boolean;
begin
  for v_caso in
    select * from (values
      ('admin ativo',                     '80000000-0000-0000-0000-0000000000a1'::uuid, true,  true),
      ('admin inativo',                   '80000000-0000-0000-0000-0000000000a2'::uuid, false, false),
      ('equipe com site.ver',             '80000000-0000-0000-0000-0000000000e1'::uuid, true,  false),
      ('equipe inativa com a linha',      '80000000-0000-0000-0000-0000000000e2'::uuid, false, false),
      ('equipe com troca pendente',       '80000000-0000-0000-0000-0000000000e3'::uuid, false, false),
      ('equipe sem nenhuma linha',        '80000000-0000-0000-0000-0000000000e5'::uuid, false, false),
      ('cliente',                         '80000000-0000-0000-0000-0000000000c1'::uuid, false, false),
      ('empreiteiro',                     '80000000-0000-0000-0000-0000000000b1'::uuid, false, false),
      ('fornecedor',                      '80000000-0000-0000-0000-0000000000f1'::uuid, false, false),
      ('ex-equipe agora cliente',         '80000000-0000-0000-0000-0000000000d1'::uuid, false, false),
      ('ex-equipe agora empreiteiro',     '80000000-0000-0000-0000-0000000000d2'::uuid, false, false),
      ('ex-equipe agora fornecedor',      '80000000-0000-0000-0000-0000000000d3'::uuid, false, false)
    ) as t(descricao, id, esperado_site_ver, esperado_contatos_ver)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caso.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_ver := public.tem_permissao('site.ver');
    v_contatos := public.tem_permissao('contatos.ver');
    v_inexistente := public.tem_permissao('nao.existe');
    v_nula := public.tem_permissao(null);

    execute 'reset role';

    if v_ver is distinct from v_caso.esperado_site_ver then
      raise exception 'FALHA: tem_permissao(site.ver) para % deveria ser %, veio %',
        v_caso.descricao, v_caso.esperado_site_ver, v_ver;
    end if;
    if v_contatos is distinct from v_caso.esperado_contatos_ver then
      raise exception 'FALHA: tem_permissao(contatos.ver) para % deveria ser %, veio %',
        v_caso.descricao, v_caso.esperado_contatos_ver, v_contatos;
    end if;
    if v_inexistente is distinct from false then
      raise exception 'FALHA: tem_permissao(nao.existe) para % deveria ser false, veio %', v_caso.descricao, v_inexistente;
    end if;
    if v_nula is distinct from false then
      raise exception 'FALHA: tem_permissao(null) para % deveria ser false, veio %', v_caso.descricao, v_nula;
    end if;
  end loop;
end $$;

do $$
declare
  v_caso record;
  v_lista text[];
begin
  for v_caso in
    select * from (values
      ('admin ativo',                 '80000000-0000-0000-0000-0000000000a1'::uuid, 24),
      ('admin inativo',               '80000000-0000-0000-0000-0000000000a2'::uuid, 0),
      ('equipe e1',                   '80000000-0000-0000-0000-0000000000e1'::uuid, 3),
      ('equipe com as 24',            '80000000-0000-0000-0000-0000000000e4'::uuid, 24),
      ('equipe sem nenhuma linha',    '80000000-0000-0000-0000-0000000000e5'::uuid, 0),
      ('equipe inativa',              '80000000-0000-0000-0000-0000000000e2'::uuid, 0),
      ('equipe com troca pendente',   '80000000-0000-0000-0000-0000000000e3'::uuid, 0),
      ('cliente',                     '80000000-0000-0000-0000-0000000000c1'::uuid, 0),
      ('empreiteiro',                 '80000000-0000-0000-0000-0000000000b1'::uuid, 0),
      ('fornecedor',                  '80000000-0000-0000-0000-0000000000f1'::uuid, 0),
      ('ex-equipe agora cliente',     '80000000-0000-0000-0000-0000000000d1'::uuid, 0)
    ) as t(descricao, id, esperado_qtd)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caso.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_lista := public.minhas_permissoes();
    execute 'reset role';

    if v_lista is null then
      raise exception 'FALHA: minhas_permissoes para % devolveu null', v_caso.descricao;
    end if;
    if cardinality(v_lista) <> v_caso.esperado_qtd then
      raise exception 'FALHA: minhas_permissoes para % deveria ter % itens, veio % (%)',
        v_caso.descricao, v_caso.esperado_qtd, cardinality(v_lista), v_lista;
    end if;
    if v_caso.esperado_qtd = 24 and not (v_lista @> public.catalogo_permissoes() and v_lista <@ public.catalogo_permissoes()) then
      raise exception 'FALHA: minhas_permissoes para % deveria ser o catálogo inteiro', v_caso.descricao;
    end if;
    if v_caso.descricao = 'equipe e1'
       and not (v_lista @> array['site.ver', 'site.editar', 'financeiro.ver'] and v_lista <@ array['site.ver', 'site.editar', 'financeiro.ver']) then
      raise exception 'FALHA: minhas_permissoes da equipe e1 deveria ser só as 3 dela, veio %', v_lista;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Anônimo: nada.
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform public.tem_permissao('site.ver');
    raise exception 'FALHA: anon conseguiu executar tem_permissao';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.minhas_permissoes();
    raise exception 'FALHA: anon conseguiu executar minhas_permissoes';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.equipe_permissoes;
    raise exception 'FALHA: anon conseguiu ler equipe_permissoes';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e5', 'site.ver');
    raise exception 'FALHA: anon conseguiu inserir em equipe_permissoes';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.equipe_permissoes;
    raise exception 'FALHA: anon conseguiu apagar de equipe_permissoes';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Cliente: não lê nada.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.equipe_permissoes) <> 0 then
    raise exception 'FALHA: cliente lê equipe_permissoes';
  end if;

  -- O trigger de validação roda como o próprio cliente, que não enxerga o perfil alvo: ele pode barrar
  -- antes do RLS (check_violation). Vale qualquer recusa; o e5 continua sem linhas (conferido no fim).
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e5', 'site.ver');
    raise exception 'FALHA: cliente conseguiu inserir em equipe_permissoes';
  exception when insufficient_privilege or check_violation then
    null;
  end;
  begin
    delete from public.equipe_permissoes;
    get diagnostics v_linhas = row_count;
    if v_linhas <> 0 then
      raise exception 'FALHA: cliente apagou % linha(s) de equipe_permissoes', v_linhas;
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Equipe com as 22 permissões: lê só as próprias linhas e não escreve nada, nem na própria conta.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-0000000000e4","role":"authenticated"}';

do $$
declare
  v_linhas integer;
begin
  if (select count(*) from public.equipe_permissoes) <> 24
     or exists (select 1 from public.equipe_permissoes where profile_id <> '80000000-0000-0000-0000-0000000000e4') then
    raise exception 'FALHA: a equipe deveria ler só as próprias 24 linhas';
  end if;

  -- INSERT na própria conta (o admin é quem concede) e em outra conta.
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e4', 'site.ver');
    raise exception 'FALHA: equipe com as 22 conseguiu inserir na própria conta';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e5', 'site.ver');
    raise exception 'FALHA: equipe com as 22 conseguiu conceder a outra conta';
  exception when insufficient_privilege then
    null;
  end;

  -- DELETE: ou erro de privilégio, ou nenhuma linha afetada.
  begin
    delete from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e4';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 0 then
      raise exception 'FALHA: equipe apagou % permissão(ões) da própria conta', v_linhas;
    end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e1';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 0 then
      raise exception 'FALHA: equipe apagou % permissão(ões) de outra conta', v_linhas;
    end if;
  exception when insufficient_privilege then
    null;
  end;

  -- Autopromoção e reativação: nem a própria conta nem a de outra pessoa (contrato §6).
  begin
    update public.profiles set papel = 'admin' where id = '80000000-0000-0000-0000-0000000000e4';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 0 then
      raise exception 'FALHA: equipe com as 22 se promoveu a admin';
    end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set ativo = true where id = '80000000-0000-0000-0000-0000000000e2';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 0 then
      raise exception 'FALHA: equipe com as 22 reativou outra conta';
    end if;
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set ativo = false where id = '80000000-0000-0000-0000-0000000000a1';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 0 then
      raise exception 'FALHA: equipe com as 22 desativou o admin';
    end if;
  exception when insufficient_privilege then
    null;
  end;
  if public.tem_permissao('site.ver') is not true then
    raise exception 'FALHA: equipe com as 22 deveria seguir com site.ver';
  end if;
  if public.papel_atual() is distinct from 'equipe' then
    raise exception 'FALHA: o papel da equipe mudou durante o teste';
  end if;

  -- UPDATE: sem privilégio.
  begin
    update public.equipe_permissoes set concedida_em = now() where profile_id = '80000000-0000-0000-0000-0000000000e4';
    raise exception 'FALHA: equipe com as 22 conseguiu dar UPDATE em equipe_permissoes';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.equipe_permissoes set profile_id = '80000000-0000-0000-0000-0000000000e5'
     where profile_id = '80000000-0000-0000-0000-0000000000e4';
    raise exception 'FALHA: equipe com as 22 conseguiu passar permissões para outra conta';
  exception when insufficient_privilege then
    null;
  end;

  if (select count(*) from public.equipe_permissoes) <> 24 then
    raise exception 'FALHA: as 24 linhas da própria equipe deveriam continuar lá';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Equipe com 3 permissões: lê só as dela.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.equipe_permissoes) <> 3
     or exists (select 1 from public.equipe_permissoes where profile_id <> '80000000-0000-0000-0000-0000000000e1') then
    raise exception 'FALHA: a equipe e1 deveria ler só as próprias 3 linhas';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin: lê tudo, concede e remove; ator e data vêm do banco; tudo na auditoria.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

do $$
declare
  v_inseridas_antes bigint;
  v_removidas_antes bigint;
  v_linhas integer;
  v_linha public.equipe_permissoes;
begin
  -- Só as linhas da fixture: em produção já existem permissões reais da equipe.
  if (select count(*) from public.equipe_permissoes where profile_id::text like '80000000-%') <> (3 + 1 + 1 + 3 + 24) then
    raise exception 'FALHA: o admin deveria ler as 32 linhas da fixture, leu %',
      (select count(*) from public.equipe_permissoes where profile_id::text like '80000000-%');
  end if;

  select count(*) into v_inseridas_antes from public.auditoria
   where tabela = 'equipe_permissoes' and acao = 'INSERT' and ator_id = '80000000-0000-0000-0000-0000000000a1';
  select count(*) into v_removidas_antes from public.auditoria
   where tabela = 'equipe_permissoes' and acao = 'DELETE' and ator_id = '80000000-0000-0000-0000-0000000000a1';

  -- O corpo manda outro ator e outra data: o banco ignora.
  insert into public.equipe_permissoes (profile_id, permissao, concedida_por, concedida_em)
  values ('80000000-0000-0000-0000-0000000000e5', 'site.ver',
          '80000000-0000-0000-0000-0000000000e1', '2000-01-01 00:00:00+00');
  insert into public.equipe_permissoes (profile_id, permissao)
  values ('80000000-0000-0000-0000-0000000000e5', 'site.editar');

  select * into v_linha from public.equipe_permissoes
   where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'site.ver';
  if v_linha.concedida_por is distinct from '80000000-0000-0000-0000-0000000000a1'::uuid then
    raise exception 'FALHA: concedida_por deveria ser o admin da sessão, veio %', v_linha.concedida_por;
  end if;
  if v_linha.concedida_em is distinct from now() then
    raise exception 'FALHA: concedida_em deveria vir do banco (now()), veio %', v_linha.concedida_em;
  end if;

  -- Admin também respeita a dependência.
  begin
    delete from public.equipe_permissoes
     where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'site.ver';
    raise exception 'FALHA: admin apagou site.ver com site.editar presente';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e5', 'obras.aprovar');
    raise exception 'FALHA: admin concedeu obras.aprovar sem obras.ver';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000c1', 'site.ver');
    raise exception 'FALHA: admin concedeu permissão a um cliente';
  exception when check_violation then
    null;
  end;
  begin
    update public.equipe_permissoes set concedida_em = now()
     where profile_id = '80000000-0000-0000-0000-0000000000e5';
    raise exception 'FALHA: admin conseguiu dar UPDATE em equipe_permissoes';
  exception when insufficient_privilege then
    null;
  end;

  delete from public.equipe_permissoes
   where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'site.editar';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin deveria apagar 1 linha (site.editar), apagou %', v_linhas;
  end if;
  delete from public.equipe_permissoes
   where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'site.ver';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin deveria apagar 1 linha (site.ver), apagou %', v_linhas;
  end if;

  -- Auditoria: 2 concessões e 2 remoções, com o admin como ator.
  if (select count(*) from public.auditoria
       where tabela = 'equipe_permissoes' and acao = 'INSERT' and ator_id = '80000000-0000-0000-0000-0000000000a1')
     <> v_inseridas_antes + 2 then
    raise exception 'FALHA: auditoria deveria ter 2 INSERT novos de equipe_permissoes com o admin como ator';
  end if;
  if (select count(*) from public.auditoria
       where tabela = 'equipe_permissoes' and acao = 'DELETE' and ator_id = '80000000-0000-0000-0000-0000000000a1')
     <> v_removidas_antes + 2 then
    raise exception 'FALHA: auditoria deveria ter 2 DELETE novos de equipe_permissoes com o admin como ator';
  end if;
  if not exists (
    select 1 from public.auditoria
     where tabela = 'equipe_permissoes' and acao = 'INSERT' and registro_id = v_linha.id
       and ator_id = '80000000-0000-0000-0000-0000000000a1'
       and depois ->> 'concedida_por' = '80000000-0000-0000-0000-0000000000a1'
       and depois ->> 'permissao' = 'site.ver'
  ) then
    raise exception 'FALHA: a auditoria da concessão deveria guardar o ator verdadeiro e a permissão';
  end if;
  if not exists (
    select 1 from public.auditoria
     where tabela = 'equipe_permissoes' and acao = 'DELETE' and registro_id = v_linha.id
       and ator_id = '80000000-0000-0000-0000-0000000000a1'
       and antes ->> 'permissao' = 'site.ver'
  ) then
    raise exception 'FALHA: a auditoria da remoção deveria guardar a permissão apagada';
  end if;
  if (select count(*) from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e5') <> 0 then
    raise exception 'FALHA: o e5 deveria ter ficado sem linhas';
  end if;
end $$;

-- Admin inativo (a2): não lê nem escreve (pode ser barrado pelo trigger ou pelo RLS).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.equipe_permissoes) <> 0 then
    raise exception 'FALHA: admin inativo lê equipe_permissoes';
  end if;
  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e5', 'site.ver');
    raise exception 'FALHA: admin inativo conseguiu conceder permissão';
  exception when insufficient_privilege or check_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Apagar o admin que concedeu: "on delete set null" não pode travar na imutabilidade da linha.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

insert into public.equipe_permissoes (profile_id, permissao)
values ('80000000-0000-0000-0000-0000000000e5', 'contatos.ver');

reset role;

do $$
begin
  if (select concedida_por from public.equipe_permissoes
       where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'contatos.ver')
     is distinct from '80000000-0000-0000-0000-0000000000a3'::uuid then
    raise exception 'FALHA: concedida_por deveria ser o admin a3';
  end if;

  -- Enquanto o admin existe, anular concedida_por à mão continua proibido.
  begin
    update public.equipe_permissoes set concedida_por = null
     where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'contatos.ver';
    raise exception 'FALHA: concedida_por foi anulada à mão';
  exception when check_violation then
    null;
  end;

  delete from public.profiles where id = '80000000-0000-0000-0000-0000000000a3';

  if not exists (
    select 1 from public.equipe_permissoes
     where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'contatos.ver' and concedida_por is null
  ) then
    raise exception 'FALHA: apagar o admin que concedeu deveria deixar a linha com concedida_por null';
  end if;
end $$;

-- Estado final das contas que tentaram escrever: nada mudou.
do $$
begin
  if (select count(*) from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e4') <> 24 then
    raise exception 'FALHA: o e4 deveria continuar com as 24 permissões';
  end if;
  if (select count(*) from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e1') <> 3 then
    raise exception 'FALHA: o e1 deveria continuar com as 3 permissões';
  end if;
  if (select count(*) from public.equipe_permissoes where profile_id = '80000000-0000-0000-0000-0000000000e5') <> 1 then
    raise exception 'FALHA: o e5 deveria ter só a contatos.ver do admin a3 (cliente e admin inativo não podem ter gravado nada)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- service_role (a secret key): grava e lê; não muda linha; as travas continuam valendo.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
set local request.jwt.claims = '';

do $$
begin
  insert into public.equipe_permissoes (profile_id, permissao)
  values ('80000000-0000-0000-0000-0000000000e5', 'painel.servidor');
  if not exists (
    select 1 from public.equipe_permissoes
    where profile_id = '80000000-0000-0000-0000-0000000000e5'
      and permissao = 'painel.servidor'
      and concedida_por is null
  ) then
    raise exception 'FALHA: service_role deveria gravar, sem ator, em equipe_permissoes';
  end if;

  begin
    insert into public.equipe_permissoes (profile_id, permissao)
    values ('80000000-0000-0000-0000-0000000000e5', 'site.editar');
    raise exception 'FALHA: service_role pulou o pré-requisito';
  exception when check_violation then
    null;
  end;

  begin
    update public.equipe_permissoes set concedida_em = now()
    where profile_id = '80000000-0000-0000-0000-0000000000e5';
    raise exception 'FALHA: service_role alterou uma linha imutável';
  exception when check_violation or insufficient_privilege then
    null;
  end;

  delete from public.equipe_permissoes
  where profile_id = '80000000-0000-0000-0000-0000000000e5' and permissao = 'painel.servidor';
  if found is not true then
    raise exception 'FALHA: service_role deveria remover a linha';
  end if;
end $$;

reset role;

select 'OK: permissões da Etapa 8 (catálogo, tabela, dependências, tem_permissao, minhas_permissoes) passaram nos testes' as resultado;

rollback;
