-- Testes de RLS da Etapa 2, parte A (site público).
-- Rode depois de aplicar todas as migrations. Como rodar: cole no SQL Editor do
-- Supabase ou use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa2_site_publico_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco (nem as funções auxiliares abaixo). Se
-- alguma verificação falhar, o script para com "FALHA: ..."; se chegar ao fim,
-- imprime "OK" no último select.
-- Os itens de teste têm rótulos começando com "E2 " e as verificações só olham
-- para eles, então dados reais já cadastrados não atrapalham.

begin;

-- Fixture: contas fake (cliente, admin, equipe e admin com troca de senha pendente).
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000002c1', 'authenticated', 'authenticated', 'e2-cliente-teste@example.com'),
  ('00000000-0000-0000-0000-0000000002a1', 'authenticated', 'authenticated', 'e2-admin-teste@example.com'),
  ('00000000-0000-0000-0000-0000000002e1', 'authenticated', 'authenticated', 'e2-equipe-teste@example.com'),
  ('00000000-0000-0000-0000-0000000002a2', 'authenticated', 'authenticated', 'e2-admin-pendente-teste@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000002c1', 'cliente', 'E2 Cliente Teste', true, false),
  ('00000000-0000-0000-0000-0000000002a1', 'admin', 'E2 Admin Teste', true, false),
  ('00000000-0000-0000-0000-0000000002e1', 'equipe', 'E2 Equipe Teste', true, false),
  ('00000000-0000-0000-0000-0000000002a2', 'admin', 'E2 Admin Senha Pendente Teste', true, true);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000002e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

-- Conteúdo: um item publicado e um oculto em cada tabela; lotes e mídias
-- pendurados em donos publicados e ocultos. Escrito como postgres (ignora RLS).
insert into public.servicos (titulo, slug, publicado)
values
  ('E2 servico publicado', 'e2-servico-publicado', true),
  ('E2 servico oculto', 'e2-servico-oculto', false);

insert into public.portfolio_projetos (id, titulo, slug, publicado)
values
  ('e2000000-0000-0000-0000-000000000031', 'E2 projeto publicado', 'e2-projeto-publicado', true),
  ('e2000000-0000-0000-0000-000000000032', 'E2 projeto oculto', 'e2-projeto-oculto', false);

insert into public.loteamentos (id, nome, slug, publicado)
values
  ('e2000000-0000-0000-0000-000000000011', 'E2 loteamento publicado', 'e2-loteamento-publicado', true),
  ('e2000000-0000-0000-0000-000000000012', 'E2 loteamento oculto', 'e2-loteamento-oculto', false);

insert into public.lotes (id, loteamento_id, svg_id, quadra, numero, area_m2, observacao)
values
  ('e2000000-0000-0000-0000-000000000021', 'e2000000-0000-0000-0000-000000000011', 'e2-svg-1', 'E2A', '1', 250.00, 'E2 lote do loteamento publicado'),
  ('e2000000-0000-0000-0000-000000000022', 'e2000000-0000-0000-0000-000000000012', 'e2-svg-1', 'E2A', '1', 250.00, 'E2 lote do loteamento oculto');

insert into public.midias (tipo, storage_path, legenda, portfolio_projeto_id, loteamento_id)
values
  ('foto', 'portfolio/e2000000-0000-0000-0000-000000000031/projeto-publicado.jpg', 'E2 midia projeto publicado', 'e2000000-0000-0000-0000-000000000031', null),
  ('foto', 'portfolio/e2000000-0000-0000-0000-000000000032/projeto-oculto.jpg', 'E2 midia projeto oculto', 'e2000000-0000-0000-0000-000000000032', null),
  ('video', 'loteamentos/e2000000-0000-0000-0000-000000000011/loteamento-publicado.mp4', 'E2 midia loteamento publicado', null, 'e2000000-0000-0000-0000-000000000011'),
  ('video', 'loteamentos/e2000000-0000-0000-0000-000000000012/loteamento-oculto.mp4', 'E2 midia loteamento oculto', null, 'e2000000-0000-0000-0000-000000000012');

insert into public.depoimentos (nome, texto, publicado)
values
  ('E2 depoimento publicado', 'Ótimo trabalho.', true),
  ('E2 depoimento oculto', 'Ainda sem autorização.', false);

insert into public.contatos (id, nome, mensagem, loteamento_id, lote_id)
values
  ('e2000000-0000-0000-0000-000000000041', 'E2 contato', 'Tenho interesse no lote.',
   'e2000000-0000-0000-0000-000000000011', 'e2000000-0000-0000-0000-000000000021');

-- Arquivo de fixture no bucket, para testar update de quem não pode escrever.
insert into storage.objects (bucket_id, name)
values ('site-publico', 'e2-teste/fixture.png');

-- Funções auxiliares (somem no rollback). Rodam com o privilégio de quem chama,
-- então medem exatamente o que aquele papel enxerga e consegue escrever.

-- Rótulos de tudo que o papel atual enxerga entre os itens "E2 ..." (menos contatos).
create function public.teste_etapa2_visiveis()
returns table (tabela text, rotulo text)
language sql
stable
as $$
  select 'servicos', titulo from public.servicos where titulo like 'E2 %'
  union all
  select 'portfolio_projetos', titulo from public.portfolio_projetos where titulo like 'E2 %'
  union all
  select 'loteamentos', nome from public.loteamentos where nome like 'E2 %'
  union all
  select 'lotes', observacao from public.lotes where observacao like 'E2 %'
  union all
  select 'midias', legenda from public.midias where legenda like 'E2 %'
  union all
  select 'depoimentos', nome from public.depoimentos where nome like 'E2 %'
$$;

-- p_ocultos = false: só os publicados (e nenhum lote/mídia de dono oculto).
-- p_ocultos = true: publicados e ocultos (staff).
create function public.teste_etapa2_confere(p_quem text, p_ocultos boolean)
returns void
language plpgsql
as $$
declare
  v_esperado record;
  v_viu int;
begin
  for v_esperado in
    select *
    from (values
      ('servicos', 1, 1),
      ('portfolio_projetos', 1, 1),
      ('loteamentos', 1, 1),
      ('lotes', 1, 1),
      ('midias', 2, 2),
      ('depoimentos', 1, 1)
    ) as e (tabela, publicados, ocultos)
  loop
    select count(*) into v_viu
    from public.teste_etapa2_visiveis() v
    where v.tabela = v_esperado.tabela and v.rotulo like '%publicado%';
    if v_viu <> v_esperado.publicados then
      raise exception 'FALHA: % deveria ver % item(ns) publicado(s) em %, viu %',
        p_quem, v_esperado.publicados, v_esperado.tabela, v_viu;
    end if;

    select count(*) into v_viu
    from public.teste_etapa2_visiveis() v
    where v.tabela = v_esperado.tabela and v.rotulo like '%oculto%';
    if v_viu <> (case when p_ocultos then v_esperado.ocultos else 0 end) then
      raise exception 'FALHA: % viu % item(ns) oculto(s) em % (esperado %)',
        p_quem, v_viu, v_esperado.tabela, case when p_ocultos then v_esperado.ocultos else 0 end;
    end if;
  end loop;

  if (select count(*) from public.configuracoes_site) <> 1 then
    raise exception 'FALHA: % deveria ver exatamente 1 linha de configuracoes_site', p_quem;
  end if;
end;
$$;

-- Quem não é staff: nenhuma escrita funciona em nenhuma tabela da parte A.
-- Sem privilégio a escrita falha com insufficient_privilege (42501); sem política
-- ela atinge 0 linhas; qualquer outro resultado é falha.
create function public.teste_etapa2_nega_escritas(p_quem text)
returns void
language plpgsql
as $$
declare
  v_sql text;
  v_linhas int;
begin
  foreach v_sql in array array[
    $q$insert into public.configuracoes_site (unico) values (true)$q$,
    $q$update public.configuracoes_site set whatsapp = 'intruso'$q$,
    $q$delete from public.configuracoes_site$q$,
    $q$insert into public.servicos (titulo, slug) values ('Intruso', 'e2-intruso')$q$,
    $q$update public.servicos set titulo = 'Intruso'$q$,
    $q$delete from public.servicos$q$,
    $q$insert into public.portfolio_projetos (titulo, slug) values ('Intruso', 'e2-intruso')$q$,
    $q$update public.portfolio_projetos set titulo = 'Intruso'$q$,
    $q$delete from public.portfolio_projetos$q$,
    $q$insert into public.loteamentos (nome, slug) values ('Intruso', 'e2-intruso')$q$,
    $q$update public.loteamentos set nome = 'Intruso'$q$,
    $q$delete from public.loteamentos$q$,
    $q$insert into public.lotes (loteamento_id, quadra, numero) values ('e2000000-0000-0000-0000-000000000011', 'X', '99')$q$,
    $q$update public.lotes set status = 'vendido'$q$,
    $q$delete from public.lotes$q$,
    $q$insert into public.midias (tipo, storage_path, loteamento_id) values ('foto', 'e2-intruso.jpg', 'e2000000-0000-0000-0000-000000000011')$q$,
    $q$update public.midias set legenda = 'Intruso'$q$,
    $q$delete from public.midias$q$,
    $q$insert into public.depoimentos (nome, texto) values ('Intruso', 'x')$q$,
    $q$update public.depoimentos set nome = 'Intruso'$q$,
    $q$delete from public.depoimentos$q$,
    $q$insert into public.contatos (nome, mensagem) values ('Intruso', 'x')$q$,
    $q$update public.contatos set lido = true$q$,
    $q$update public.contatos set mensagem = 'Intruso'$q$,
    $q$delete from public.contatos$q$
  ] loop
    begin
      execute v_sql;
      get diagnostics v_linhas = row_count;
      if v_linhas > 0 then
        raise exception 'FALHA: % conseguiu executar: %', p_quem, v_sql;
      end if;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;

-- Staff: insert, update e delete funcionam nas tabelas de conteúdo; a linha
-- única de configuração só aceita update.
create function public.teste_etapa2_staff_escreve(p_quem text)
returns void
language plpgsql
as $$
declare
  v_servico uuid;
  v_projeto uuid;
  v_loteamento uuid;
  v_lote uuid;
  v_midia uuid;
  v_depoimento uuid;
  v_linhas int;
begin
  update public.configuracoes_site set whatsapp = '5531900000000';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar configuracoes_site', p_quem;
  end if;

  insert into public.servicos (titulo, slug) values ('STAFF servico', 'staff-servico-' || p_quem)
  returning id into v_servico;
  update public.servicos set titulo = 'STAFF servico editado', publicado = true where id = v_servico;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar servicos', p_quem;
  end if;

  insert into public.portfolio_projetos (titulo, slug) values ('STAFF projeto', 'staff-projeto-' || p_quem)
  returning id into v_projeto;
  update public.portfolio_projetos set publicado = true where id = v_projeto;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar portfolio_projetos', p_quem;
  end if;

  insert into public.loteamentos (nome, slug) values ('STAFF loteamento', 'staff-loteamento-' || p_quem)
  returning id into v_loteamento;
  update public.loteamentos set publicado = true where id = v_loteamento;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar loteamentos', p_quem;
  end if;

  insert into public.lotes (loteamento_id, quadra, numero) values (v_loteamento, 'S', '1')
  returning id into v_lote;
  update public.lotes set status = 'vendido' where id = v_lote;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar lotes', p_quem;
  end if;

  insert into public.midias (tipo, storage_path, portfolio_projeto_id)
  values ('foto', 'portfolio/' || v_projeto || '/staff-' || p_quem || '.jpg', v_projeto)
  returning id into v_midia;
  update public.midias set legenda = 'STAFF legenda' where id = v_midia;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar midias', p_quem;
  end if;

  insert into public.depoimentos (nome, texto) values ('STAFF depoimento', 'x')
  returning id into v_depoimento;
  update public.depoimentos set publicado = true where id = v_depoimento;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar depoimentos', p_quem;
  end if;

  delete from public.midias where id = v_midia;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar midias', p_quem;
  end if;

  delete from public.servicos where id = v_servico;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar servicos', p_quem;
  end if;

  delete from public.portfolio_projetos where id = v_projeto;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar portfolio_projetos', p_quem;
  end if;

  delete from public.depoimentos where id = v_depoimento;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar depoimentos', p_quem;
  end if;

  delete from public.loteamentos where id = v_loteamento;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar loteamentos', p_quem;
  end if;
  if exists (select 1 from public.lotes where id = v_lote) then
    raise exception 'FALHA: apagar o loteamento não apagou o lote em cascata';
  end if;

  begin
    insert into public.configuracoes_site (unico) values (true);
    raise exception 'FALHA: % conseguiu inserir outra linha em configuracoes_site', p_quem;
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.configuracoes_site;
    raise exception 'FALHA: % conseguiu apagar configuracoes_site', p_quem;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Staff no bucket site-publico: lê e (pela política) apaga, mas não envia nem
-- altera pela sessão; o envio é feito só pelo servidor com a secret key.
create function public.teste_etapa2_staff_storage(p_quem text)
returns void
language plpgsql
as $$
declare
  v_linhas int;
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'site-publico' and name = 'e2-teste/fixture.png'
  ) then
    raise exception 'FALHA: % não conseguiu ler arquivo do bucket site-publico', p_quem;
  end if;

  begin
    insert into storage.objects (bucket_id, name) values ('site-publico', 'e2-teste/' || p_quem || '.png');
    raise exception 'FALHA: % conseguiu enviar arquivo para o bucket site-publico', p_quem;
  exception when insufficient_privilege then
    null;
  end;

  -- Sem política de UPDATE o RLS esconde a linha: 0 linhas ou erro de privilégio.
  begin
    update storage.objects set metadata = '{"editado":true}'
    where bucket_id = 'site-publico' and name = 'e2-teste/fixture.png';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: % conseguiu alterar arquivo do bucket site-publico', p_quem;
    end if;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

grant execute on function public.teste_etapa2_visiveis() to anon, authenticated;
grant execute on function public.teste_etapa2_staff_storage(text) to anon, authenticated;
grant execute on function public.teste_etapa2_confere(text, boolean) to anon, authenticated;
grant execute on function public.teste_etapa2_nega_escritas(text) to anon, authenticated;
grant execute on function public.teste_etapa2_staff_escreve(text) to anon, authenticated;

-- Estrutura: RLS ligado, anon sem escrita nenhuma, contatos fechado para anon.
do $$
declare
  v_tabela text;
  v_bucket storage.buckets;
begin
  foreach v_tabela in array array[
    'configuracoes_site', 'servicos', 'portfolio_projetos', 'loteamentos',
    'lotes', 'midias', 'depoimentos', 'contatos'
  ] loop
    if not (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_tabela
    ) then
      raise exception 'FALHA: RLS desligado em %', v_tabela;
    end if;
    if has_table_privilege('anon', 'public.' || v_tabela, 'insert')
      or has_table_privilege('anon', 'public.' || v_tabela, 'update')
      or has_table_privilege('anon', 'public.' || v_tabela, 'delete')
    then
      raise exception 'FALHA: anon tem privilégio de escrita em %', v_tabela;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.contatos', 'select') then
    raise exception 'FALHA: anon tem privilégio de leitura em contatos';
  end if;
  if has_table_privilege('authenticated', 'public.contatos', 'insert') then
    raise exception 'FALHA: authenticated tem privilégio de insert em contatos';
  end if;

  select * into v_bucket from storage.buckets where id = 'site-publico';
  if not found then
    raise exception 'FALHA: bucket site-publico não existe';
  end if;
  if not v_bucket.public then
    raise exception 'FALHA: bucket site-publico deveria ser público';
  end if;
  if v_bucket.file_size_limit is distinct from 104857600 then
    raise exception 'FALHA: limite do bucket site-publico deveria ser 100 MB, é %', v_bucket.file_size_limit;
  end if;
  -- A exclusão de objeto pela sessão é checada pela política, não por um DELETE
  -- real: versões novas do Supabase bloqueiam DELETE direto em storage.objects
  -- (gatilho storage.protect_delete), o que faria o teste falhar por outro motivo.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'DELETE'
      and qual like '%site-publico%'
      and (qual like '%e_staff%' or qual like '%site.editar%')
  ) then
    raise exception 'FALHA: política de exclusão do staff no bucket site-publico não existe';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and qual like '%site-publico%' and cmd = 'SELECT'
  ) then
    raise exception 'FALHA: política de leitura do staff no bucket site-publico não existe';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'staff envia arquivos para o site-publico',
        'staff atualiza arquivos do site-publico'
      )
  ) then
    raise exception 'FALHA: políticas de envio/atualização do staff no bucket site-publico deveriam ter sido removidas';
  end if;

  if not (
    v_bucket.allowed_mime_types @> array[
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'image/svg+xml', 'video/mp4', 'video/webm'
    ]
    and v_bucket.allowed_mime_types <@ array[
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'image/svg+xml', 'video/mp4', 'video/webm'
    ]
  ) then
    raise exception 'FALHA: tipos permitidos do bucket site-publico diferentes do contrato: %', v_bucket.allowed_mime_types;
  end if;
end $$;

-- Regras de dados e gatilhos, como postgres.
do $$
begin
  if (select count(*) from public.configuracoes_site) <> 1 then
    raise exception 'FALHA: configuracoes_site deveria ter exatamente 1 linha';
  end if;

  begin
    insert into public.configuracoes_site (unico) values (true);
    raise exception 'FALHA: configuracoes_site aceitou uma segunda linha';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.configuracoes_site (unico) values (false);
    raise exception 'FALHA: configuracoes_site aceitou unico = false';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.servicos (titulo, slug) values ('E2 duplicado', 'e2-servico-publicado');
    raise exception 'FALHA: servicos aceitou slug repetido';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.midias (tipo, storage_path) values ('foto', 'e2-sem-dono.jpg');
    raise exception 'FALHA: midias aceitou mídia sem dono';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.midias (tipo, storage_path, portfolio_projeto_id, loteamento_id)
    values (
      'foto', 'e2-dois-donos.jpg',
      'e2000000-0000-0000-0000-000000000031',
      'e2000000-0000-0000-0000-000000000011'
    );
    raise exception 'FALHA: midias aceitou mídia com dois donos';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.lotes (loteamento_id, quadra, numero)
    values ('e2000000-0000-0000-0000-000000000011', 'E2A', '1');
    raise exception 'FALHA: lotes aceitou quadra/número repetidos no mesmo loteamento';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.lotes (loteamento_id, svg_id, quadra, numero)
    values ('e2000000-0000-0000-0000-000000000011', 'e2-svg-1', 'E2B', '1');
    raise exception 'FALHA: lotes aceitou svg_id repetido no mesmo loteamento';
  exception when unique_violation then
    null;
  end;

  begin
    insert into public.lotes (loteamento_id, quadra, numero, area_m2)
    values ('e2000000-0000-0000-0000-000000000011', 'E2C', '1', 0);
    raise exception 'FALHA: lotes aceitou area_m2 = 0';
  exception when check_violation then
    null;
  end;
end $$;

-- Auditoria: configuracoes_site, loteamentos e lotes registram; as demais não.
update public.configuracoes_site set sobre_titulo = 'E2 sobre', atualizado_em = '2000-01-01';
update public.servicos set resumo = 'E2', atualizado_em = '2000-01-01' where slug = 'e2-servico-publicado';
update public.contatos set lido = true, atualizado_em = '2000-01-01'
where id = 'e2000000-0000-0000-0000-000000000041';

do $$
declare
  v_linha public.auditoria;
begin
  select * into v_linha
  from public.auditoria
  where tabela = 'configuracoes_site' and acao = 'UPDATE' and depois ->> 'sobre_titulo' = 'E2 sobre';
  if not found then
    raise exception 'FALHA: update em configuracoes_site não gerou linha de auditoria';
  end if;
  if v_linha.ator_id is not null then
    raise exception 'FALHA: ator_id deveria ser nulo para escrita feita como postgres';
  end if;
  if not exists (select 1 from public.auditoria where tabela = 'configuracoes_site' and acao = 'INSERT') then
    raise exception 'FALHA: a linha inicial de configuracoes_site não foi auditada';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'loteamentos' and acao = 'INSERT'
      and registro_id = 'e2000000-0000-0000-0000-000000000011'
  ) then
    raise exception 'FALHA: insert em loteamentos não gerou linha de auditoria';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'lotes' and acao = 'INSERT'
      and registro_id = 'e2000000-0000-0000-0000-000000000021'
  ) then
    raise exception 'FALHA: insert em lotes não gerou linha de auditoria';
  end if;
  if exists (
    select 1 from public.auditoria
    where tabela in ('servicos', 'portfolio_projetos', 'midias', 'depoimentos', 'contatos')
  ) then
    raise exception 'FALHA: tabela sem [aud] gerou linha de auditoria';
  end if;

  if (select atualizado_em from public.configuracoes_site) < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em em configuracoes_site';
  end if;
  if (select atualizado_em from public.servicos where slug = 'e2-servico-publicado') < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em em servicos';
  end if;
  if (select atualizado_em from public.contatos where id = 'e2000000-0000-0000-0000-000000000041') < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em em contatos';
  end if;
end $$;

-- Anônimo: só publicados; contatos fechado; nenhuma escrita; storage fechado.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  perform public.teste_etapa2_confere('anon', false);

  begin
    perform 1 from public.contatos;
    raise exception 'FALHA: anon conseguiu ler contatos';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.contatos (nome, mensagem) values ('Intruso', 'x');
    raise exception 'FALHA: anon conseguiu inserir em contatos';
  exception when insufficient_privilege then
    null;
  end;

  perform public.teste_etapa2_nega_escritas('anon');

  begin
    insert into storage.objects (bucket_id, name) values ('site-publico', 'e2-teste/anon.png');
    raise exception 'FALHA: anon conseguiu enviar arquivo para o bucket site-publico';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Cliente: enxerga como o anônimo, não lê contatos, não escreve em nada.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002c1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if public.e_staff() or public.e_admin() then
    raise exception 'FALHA: cliente não pode ser staff nem admin';
  end if;

  perform public.teste_etapa2_confere('cliente', false);

  if (select count(*) from public.contatos where nome like 'E2 %') <> 0 then
    raise exception 'FALHA: cliente não deveria ver contatos';
  end if;

  begin
    insert into public.contatos (nome, mensagem) values ('Intruso', 'x');
    raise exception 'FALHA: cliente conseguiu inserir em contatos';
  exception when insufficient_privilege then
    null;
  end;

  perform public.teste_etapa2_nega_escritas('cliente');

  begin
    insert into storage.objects (bucket_id, name) values ('site-publico', 'e2-teste/cliente.png');
    raise exception 'FALHA: cliente conseguiu enviar arquivo para o bucket site-publico';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update storage.objects set metadata = '{"intruso":true}'
    where bucket_id = 'site-publico' and name = 'e2-teste/fixture.png';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: cliente conseguiu alterar arquivo do bucket site-publico';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Admin com troca de senha pendente: sem papel, então vale o mesmo que o cliente.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002a2","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if public.e_staff() or public.e_admin() then
    raise exception 'FALHA: troca de senha pendente não pode ser staff nem admin';
  end if;

  perform public.teste_etapa2_confere('conta com troca de senha pendente', false);

  if (select count(*) from public.contatos where nome like 'E2 %') <> 0 then
    raise exception 'FALHA: troca de senha pendente não deveria ver contatos';
  end if;

  begin
    insert into public.contatos (nome, mensagem) values ('Intruso', 'x');
    raise exception 'FALHA: troca de senha pendente conseguiu inserir em contatos';
  exception when insufficient_privilege then
    null;
  end;

  perform public.teste_etapa2_nega_escritas('conta com troca de senha pendente');

  begin
    insert into storage.objects (bucket_id, name) values ('site-publico', 'e2-teste/pendente.png');
    raise exception 'FALHA: troca de senha pendente conseguiu enviar arquivo para o bucket site-publico';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update storage.objects set metadata = '{"intruso":true}'
    where bucket_id = 'site-publico' and name = 'e2-teste/fixture.png';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: troca de senha pendente conseguiu alterar arquivo do bucket site-publico';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Equipe: vê tudo (inclusive ocultos e contatos), escreve no conteúdo, marca
-- contato como lido, mas não apaga contato; envia e altera arquivos do bucket.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002e1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if public.papel_atual() is distinct from 'equipe' or not public.e_staff() or public.e_admin() then
    raise exception 'FALHA: funções de papel da equipe retornaram valor errado';
  end if;

  perform public.teste_etapa2_confere('equipe', true);

  if (select count(*) from public.contatos where nome like 'E2 %') <> 1 then
    raise exception 'FALHA: equipe deveria ver o contato de teste';
  end if;

  perform public.teste_etapa2_staff_escreve('equipe');

  update public.contatos set lido = false where id = 'e2000000-0000-0000-0000-000000000041';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: equipe não conseguiu atualizar lido em contatos';
  end if;

  begin
    update public.contatos set mensagem = 'adulterada' where id = 'e2000000-0000-0000-0000-000000000041';
    raise exception 'FALHA: equipe conseguiu editar a mensagem de um contato';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.contatos (nome, mensagem) values ('E2 inserido pela equipe', 'x');
    raise exception 'FALHA: equipe conseguiu inserir em contatos';
  exception when insufficient_privilege then
    null;
  end;

  delete from public.contatos where id = 'e2000000-0000-0000-0000-000000000041';
  get diagnostics v_linhas = row_count;
  if v_linhas > 0 then
    raise exception 'FALHA: equipe não deveria apagar contatos (só admin)';
  end if;

  perform public.teste_etapa2_staff_storage('equipe');
end $$;

-- Admin: tudo que a equipe faz, mais apagar contatos; lê a auditoria das escritas
-- feitas pela equipe (ator_id preenchido).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000002a1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if public.papel_atual() is distinct from 'admin' or not public.e_staff() or not public.e_admin() then
    raise exception 'FALHA: funções de papel do admin retornaram valor errado';
  end if;

  perform public.teste_etapa2_confere('admin', true);

  if (select count(*) from public.contatos where nome like 'E2 %') <> 1 then
    raise exception 'FALHA: admin deveria ver o contato de teste';
  end if;

  if not exists (
    select 1 from public.auditoria
    where tabela = 'loteamentos' and acao = 'INSERT'
      and ator_id = '00000000-0000-0000-0000-0000000002e1'
  ) then
    raise exception 'FALHA: auditoria não registrou o ator da equipe ao inserir em loteamentos';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'lotes' and acao = 'INSERT'
      and ator_id = '00000000-0000-0000-0000-0000000002e1'
  ) then
    raise exception 'FALHA: auditoria não registrou o ator da equipe ao inserir em lotes';
  end if;
  if not exists (
    select 1 from public.auditoria
    where tabela = 'configuracoes_site' and acao = 'UPDATE'
      and ator_id = '00000000-0000-0000-0000-0000000002e1'
  ) then
    raise exception 'FALHA: auditoria não registrou o ator da equipe ao atualizar configuracoes_site';
  end if;

  perform public.teste_etapa2_staff_escreve('admin');

  update public.contatos set lido = true where id = 'e2000000-0000-0000-0000-000000000041';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin não conseguiu atualizar lido em contatos';
  end if;

  begin
    insert into public.contatos (nome, mensagem) values ('E2 inserido pelo admin', 'x');
    raise exception 'FALHA: admin conseguiu inserir em contatos';
  exception when insufficient_privilege then
    null;
  end;

  perform public.teste_etapa2_staff_storage('admin');

  delete from public.contatos where id = 'e2000000-0000-0000-0000-000000000041';
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: admin não conseguiu apagar contato';
  end if;
  if (select count(*) from public.contatos where nome like 'E2 %') <> 0 then
    raise exception 'FALHA: contato apagado pelo admin ainda aparece';
  end if;
end $$;

reset role;

select 'OK: todas as verificações de RLS da Etapa 2 (site público) passaram' as resultado;

rollback;
