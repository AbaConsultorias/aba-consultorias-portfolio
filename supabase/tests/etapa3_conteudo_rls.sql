-- Testes de RLS e de constraints da Etapa 3 (conteúdo público editável).
-- Rode depois de aplicar todas as migrations. Como rodar: cole no SQL Editor do
-- Supabase ou use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa3_conteudo_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco (nem as funções auxiliares abaixo). Se
-- alguma verificação falhar, o script para com "FALHA: ..."; se chegar ao fim,
-- imprime "OK" no último select.
-- Os itens de teste têm rótulos começando com "E3 " e as verificações só olham
-- para eles, então dados reais já cadastrados não atrapalham.

begin;

-- Fixture: contas fake (cliente, equipe e admin).
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000003c1', 'authenticated', 'authenticated', 'e3-cliente-teste@example.com'),
  ('00000000-0000-0000-0000-0000000003e1', 'authenticated', 'authenticated', 'e3-equipe-teste@example.com'),
  ('00000000-0000-0000-0000-0000000003a1', 'authenticated', 'authenticated', 'e3-admin-teste@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values
  ('00000000-0000-0000-0000-0000000003c1', 'cliente', 'E3 Cliente Teste', true, false),
  ('00000000-0000-0000-0000-0000000003e1', 'equipe', 'E3 Equipe Teste', true, false),
  ('00000000-0000-0000-0000-0000000003a1', 'admin', 'E3 Admin Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000003e1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

-- Um item publicado e um oculto em cada tabela nova. Escrito como postgres.
insert into public.parceiros (nome, logo_path, publicado)
values
  ('E3 parceiro publicado', 'parceiros/e3-publicado.webp', true),
  ('E3 parceiro oculto', 'parceiros/e3-oculto.webp', false);

insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, publicado)
values
  ('E3', 'E3 banner publicado', 'Texto.', 'hero/e3-publicado.webp', true),
  ('E3', 'E3 banner oculto', 'Texto.', 'hero/e3-oculto.webp', false);

insert into public.videos_instagram (video_path, legenda, publicado)
values
  ('instagram/e3-publicado.mp4', 'E3 video publicado', true),
  ('instagram/e3-oculto.mp4', 'E3 video oculto', false);

-- Dono para os testes de caminho por id.
insert into public.loteamentos (id, nome, slug)
values
  ('e3000000-0000-0000-0000-000000000011', 'E3 loteamento dono', 'e3-loteamento-dono'),
  ('e3000000-0000-0000-0000-000000000012', 'E3 loteamento outro', 'e3-loteamento-outro');

insert into public.portfolio_projetos (id, titulo, slug)
values
  ('e3000000-0000-0000-0000-000000000031', 'E3 projeto dono', 'e3-projeto-dono');

-- Funções auxiliares (somem no rollback). Rodam com o privilégio de quem chama.

create function public.teste_etapa3_visiveis()
returns table (tabela text, rotulo text)
language sql
stable
as $$
  select 'parceiros', nome from public.parceiros where nome like 'E3 %'
  union all
  select 'banners_hero', titulo from public.banners_hero where titulo like 'E3 %'
  union all
  select 'videos_instagram', legenda from public.videos_instagram where legenda like 'E3 %'
$$;

-- p_ocultos = false: só os publicados. p_ocultos = true: publicados e ocultos (staff).
create function public.teste_etapa3_confere(p_quem text, p_ocultos boolean)
returns void
language plpgsql
as $$
declare
  v_tabela text;
  v_viu int;
begin
  foreach v_tabela in array array['parceiros', 'banners_hero', 'videos_instagram'] loop
    select count(*) into v_viu
    from public.teste_etapa3_visiveis() v
    where v.tabela = v_tabela and v.rotulo like '%publicado%';
    if v_viu <> 1 then
      raise exception 'FALHA: % deveria ver 1 item publicado em %, viu %', p_quem, v_tabela, v_viu;
    end if;

    select count(*) into v_viu
    from public.teste_etapa3_visiveis() v
    where v.tabela = v_tabela and v.rotulo like '%oculto%';
    if v_viu <> (case when p_ocultos then 1 else 0 end) then
      raise exception 'FALHA: % viu % item(ns) oculto(s) em % (esperado %)',
        p_quem, v_viu, v_tabela, case when p_ocultos then 1 else 0 end;
    end if;
  end loop;
end;
$$;

-- Quem não é staff: nenhuma escrita funciona. Os inserts usam caminhos válidos,
-- então só o RLS/privilégio pode barrá-los.
create function public.teste_etapa3_nega_escritas(p_quem text)
returns void
language plpgsql
as $$
declare
  v_sql text;
  v_linhas int;
begin
  foreach v_sql in array array[
    $q$insert into public.parceiros (nome, logo_path) values ('Intruso', 'parceiros/intruso.webp')$q$,
    $q$update public.parceiros set nome = 'Intruso'$q$,
    $q$delete from public.parceiros$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path) values ('x', 'Intruso', 'x', 'hero/intruso.webp')$q$,
    $q$update public.banners_hero set titulo = 'Intruso'$q$,
    $q$delete from public.banners_hero$q$,
    $q$insert into public.videos_instagram (video_path) values ('instagram/intruso.mp4')$q$,
    $q$update public.videos_instagram set legenda = 'Intruso'$q$,
    $q$delete from public.videos_instagram$q$
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

-- Staff: insert, update e delete funcionam nas três tabelas.
create function public.teste_etapa3_staff_escreve(p_quem text)
returns void
language plpgsql
as $$
declare
  v_parceiro uuid;
  v_banner uuid;
  v_video uuid;
  v_linhas int;
begin
  insert into public.parceiros (nome, logo_path) values ('STAFF parceiro', 'parceiros/staff-' || p_quem || '.webp')
  returning id into v_parceiro;
  update public.parceiros set publicado = true where id = v_parceiro;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar parceiros', p_quem;
  end if;

  insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path)
  values ('x', 'STAFF banner', 'x', 'hero/staff-' || p_quem || '.webp')
  returning id into v_banner;
  update public.banners_hero set publicado = true where id = v_banner;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar banners_hero', p_quem;
  end if;

  insert into public.videos_instagram (video_path) values ('instagram/staff-' || p_quem || '.mp4')
  returning id into v_video;
  update public.videos_instagram set publicado = true where id = v_video;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu atualizar videos_instagram', p_quem;
  end if;

  delete from public.parceiros where id = v_parceiro;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar parceiros', p_quem;
  end if;

  delete from public.banners_hero where id = v_banner;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar banners_hero', p_quem;
  end if;

  delete from public.videos_instagram where id = v_video;
  get diagnostics v_linhas = row_count;
  if v_linhas <> 1 then
    raise exception 'FALHA: % não conseguiu apagar videos_instagram', p_quem;
  end if;
end;
$$;

grant execute on function public.teste_etapa3_visiveis() to anon, authenticated;
grant execute on function public.teste_etapa3_confere(text, boolean) to anon, authenticated;
grant execute on function public.teste_etapa3_nega_escritas(text) to anon, authenticated;
grant execute on function public.teste_etapa3_staff_escreve(text) to anon, authenticated;

-- Estrutura: RLS ligado e anon sem escrita nenhuma nas tabelas novas.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['parceiros', 'banners_hero', 'videos_instagram'] loop
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
    if not has_table_privilege('anon', 'public.' || v_tabela, 'select') then
      raise exception 'FALHA: anon deveria ler % (só os publicados, pelo RLS)', v_tabela;
    end if;
  end loop;
end $$;

-- Caminhos inválidos precisam ser rejeitados (prefixo errado, "..", "//", pasta
-- de outro dono, nada depois do prefixo).
do $$
declare
  v_sql text;
begin
  foreach v_sql in array array[
    $q$insert into public.parceiros (nome, logo_path) values ('E3 x', 'hero/a.webp')$q$,
    $q$insert into public.parceiros (nome, logo_path) values ('E3 x', 'parceiros/')$q$,
    $q$insert into public.parceiros (nome, logo_path) values ('E3 x', 'parceiros/../a.webp')$q$,
    $q$insert into public.parceiros (nome, logo_path) values ('E3 x', 'parceiros//a.webp')$q$,
    $q$insert into public.parceiros (nome, logo_path) values ('E3 x', '/parceiros/a.webp')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path) values ('x', 'E3 x', 'x', 'parceiros/a.webp')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path) values ('x', 'E3 x', 'x', 'hero/../a.webp')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path) values ('x', 'E3 x', 'x', 'hero//a.webp')$q$,
    $q$insert into public.videos_instagram (video_path) values ('hero/a.mp4')$q$,
    $q$insert into public.videos_instagram (video_path) values ('instagram/../a.mp4')$q$,
    $q$insert into public.videos_instagram (video_path) values ('instagram//a.mp4')$q$,
    $q$insert into public.videos_instagram (video_path, poster_path) values ('instagram/a.mp4', 'hero/a.webp')$q$,
    $q$insert into public.videos_instagram (video_path, poster_path) values ('instagram/a.mp4', 'instagram/../a.webp')$q$,
    $q$insert into public.servicos (titulo, slug, foto_path) values ('E3 x', 'e3-x', 'hero/a.webp')$q$,
    $q$insert into public.servicos (titulo, slug, foto_path) values ('E3 x', 'e3-x', 'servicos/../a.webp')$q$,
    $q$insert into public.servicos (titulo, slug, foto_path) values ('E3 x', 'e3-x', 'servicos//a.webp')$q$,
    $q$insert into public.servicos (titulo, slug, frente) values ('E3 x', 'e3-x', 'outra')$q$,
    $q$insert into public.depoimentos (nome, texto, origem) values ('E3 x', 'x', 'outra')$q$,
    $q$insert into public.depoimentos (nome, texto, nota) values ('E3 x', 'x', 0)$q$,
    $q$insert into public.depoimentos (nome, texto, nota) values ('E3 x', 'x', 6)$q$,
    $q$insert into public.loteamentos (nome, slug, capa_path) values ('E3 x', 'e3-x', 'hero/a.webp')$q$,
    $q$insert into public.loteamentos (id, nome, slug, capa_path) values ('e3000000-0000-0000-0000-000000000021', 'E3 x', 'e3-x', 'loteamentos/e3000000-0000-0000-0000-000000000022/a.webp')$q$,
    $q$insert into public.loteamentos (id, nome, slug, capa_path) values ('e3000000-0000-0000-0000-000000000021', 'E3 x', 'e3-x', 'loteamentos/e3000000-0000-0000-0000-000000000021/../a.webp')$q$,
    $q$insert into public.loteamentos (id, nome, slug, capa_path) values ('e3000000-0000-0000-0000-000000000021', 'E3 x', 'e3-x', 'loteamentos/e3000000-0000-0000-0000-000000000021//a.webp')$q$,
    $q$insert into public.loteamentos (id, nome, slug, banner_path) values ('e3000000-0000-0000-0000-000000000021', 'E3 x', 'e3-x', 'loteamentos/e3000000-0000-0000-0000-000000000022/a.webp')$q$,
    $q$insert into public.loteamentos (id, nome, slug, banner_mobile_path) values ('e3000000-0000-0000-0000-000000000021', 'E3 x', 'e3-x', 'servicos/a.webp')$q$,
    $q$insert into public.loteamentos (id, nome, slug, mapa_svg_path) values ('e3000000-0000-0000-0000-000000000021', 'E3 x', 'e3-x', 'loteamentos/e3000000-0000-0000-0000-000000000022/mapa.svg')$q$,
    $q$update public.loteamentos set capa_path = 'loteamentos/e3000000-0000-0000-0000-000000000012/a.webp' where id = 'e3000000-0000-0000-0000-000000000011'$q$,
    $q$update public.portfolio_projetos set capa_path = 'portfolio/e3000000-0000-0000-0000-000000000099/a.webp' where id = 'e3000000-0000-0000-0000-000000000031'$q$,
    $q$update public.portfolio_projetos set capa_path = 'loteamentos/e3000000-0000-0000-0000-000000000031/a.webp' where id = 'e3000000-0000-0000-0000-000000000031'$q$,
    $q$update public.portfolio_projetos set capa_path = 'portfolio/e3000000-0000-0000-0000-000000000031/../a.webp' where id = 'e3000000-0000-0000-0000-000000000031'$q$,
    $q$update public.portfolio_projetos set capa_path = 'portfolio/e3000000-0000-0000-0000-000000000031//a.webp' where id = 'e3000000-0000-0000-0000-000000000031'$q$,
    $q$insert into public.midias (tipo, storage_path, loteamento_id) values ('foto', 'e3-sem-pasta.webp', 'e3000000-0000-0000-0000-000000000011')$q$,
    $q$insert into public.midias (tipo, storage_path, loteamento_id) values ('foto', 'loteamentos/e3000000-0000-0000-0000-000000000012/a.webp', 'e3000000-0000-0000-0000-000000000011')$q$,
    $q$insert into public.midias (tipo, storage_path, loteamento_id) values ('foto', 'portfolio/e3000000-0000-0000-0000-000000000011/a.webp', 'e3000000-0000-0000-0000-000000000011')$q$,
    $q$insert into public.midias (tipo, storage_path, loteamento_id) values ('foto', 'loteamentos/e3000000-0000-0000-0000-000000000011/../a.webp', 'e3000000-0000-0000-0000-000000000011')$q$,
    $q$insert into public.midias (tipo, storage_path, loteamento_id) values ('foto', 'loteamentos/e3000000-0000-0000-0000-000000000011//a.webp', 'e3000000-0000-0000-0000-000000000011')$q$,
    $q$insert into public.midias (tipo, storage_path, portfolio_projeto_id) values ('foto', 'loteamentos/e3000000-0000-0000-0000-000000000031/a.webp', 'e3000000-0000-0000-0000-000000000031')$q$,
    $q$insert into public.midias (tipo, storage_path, portfolio_projeto_id) values ('foto', 'portfolio/e3000000-0000-0000-0000-000000000099/a.webp', 'e3000000-0000-0000-0000-000000000031')$q$
  ] loop
    begin
      execute v_sql;
      raise exception 'FALHA: constraint aceitou valor inválido: %', v_sql;
    exception when check_violation then
      null;
    end;
  end loop;
end $$;

-- Caminhos válidos precisam ser aceitos.
do $$
begin
  insert into public.parceiros (nome, logo_path) values ('E3 caminho ok', 'parceiros/11111111-1111-4111-8111-111111111111.webp');
  insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path)
  values ('x', 'E3 caminho ok', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp');
  insert into public.videos_instagram (video_path, poster_path, legenda)
  values ('instagram/11111111-1111-4111-8111-111111111111.mp4', 'instagram/22222222-2222-4222-8222-222222222222.webp', 'E3 caminho ok');
  insert into public.servicos (titulo, slug, foto_path, frente, itens)
  values ('E3 caminho ok', 'e3-caminho-ok', 'servicos/11111111-1111-4111-8111-111111111111.webp', 'casa', array['a', 'b']);
  insert into public.depoimentos (nome, texto, origem, nota, quando)
  values ('E3 caminho ok', 'x', 'google', 5, 'há 1 ano');

  update public.loteamentos
  set capa_path = 'loteamentos/e3000000-0000-0000-0000-000000000011/capa.webp',
      banner_path = 'loteamentos/e3000000-0000-0000-0000-000000000011/banner.webp',
      banner_mobile_path = 'loteamentos/e3000000-0000-0000-0000-000000000011/mobile.webp',
      mapa_svg_path = 'loteamentos/e3000000-0000-0000-0000-000000000011/mapa.svg'
  where id = 'e3000000-0000-0000-0000-000000000011';

  update public.portfolio_projetos
  set capa_path = 'portfolio/e3000000-0000-0000-0000-000000000031/capa.webp'
  where id = 'e3000000-0000-0000-0000-000000000031';

  insert into public.midias (tipo, storage_path, loteamento_id)
  values ('foto', 'loteamentos/e3000000-0000-0000-0000-000000000011/foto.webp', 'e3000000-0000-0000-0000-000000000011');
  insert into public.midias (tipo, storage_path, portfolio_projeto_id)
  values ('foto', 'portfolio/e3000000-0000-0000-0000-000000000031/foto.webp', 'e3000000-0000-0000-0000-000000000031');
end $$;

-- Auditoria e atualizado_em nas tabelas novas.
update public.parceiros set nome = 'E3 parceiro publicado', atualizado_em = '2000-01-01'
where nome = 'E3 parceiro publicado';

do $$
begin
  if (select atualizado_em from public.parceiros where nome = 'E3 parceiro publicado') < '2001-01-01' then
    raise exception 'FALHA: trigger não sobrescreveu atualizado_em em parceiros';
  end if;
  if not exists (
    select 1 from public.auditoria where tabela = 'parceiros' and acao = 'INSERT'
  ) then
    raise exception 'FALHA: insert em parceiros não gerou linha de auditoria';
  end if;
  if not exists (
    select 1 from public.auditoria where tabela = 'banners_hero' and acao = 'INSERT'
  ) then
    raise exception 'FALHA: insert em banners_hero não gerou linha de auditoria';
  end if;
  if not exists (
    select 1 from public.auditoria where tabela = 'videos_instagram' and acao = 'INSERT'
  ) then
    raise exception 'FALHA: insert em videos_instagram não gerou linha de auditoria';
  end if;
end $$;

-- Anônimo: só publicados; nenhuma escrita.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  perform public.teste_etapa3_confere('anon', false);
  perform public.teste_etapa3_nega_escritas('anon');
end $$;

-- Cliente: enxerga como o anônimo e não escreve em nada.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000003c1","role":"authenticated"}';

do $$
begin
  if public.e_staff() or public.e_admin() then
    raise exception 'FALHA: cliente não pode ser staff nem admin';
  end if;

  perform public.teste_etapa3_confere('cliente', false);
  perform public.teste_etapa3_nega_escritas('cliente');
end $$;

-- Equipe: vê tudo (inclusive ocultos) e escreve nas três tabelas.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000003e1","role":"authenticated"}';

do $$
begin
  if not public.e_staff() or public.e_admin() then
    raise exception 'FALHA: funções de papel da equipe retornaram valor errado';
  end if;

  perform public.teste_etapa3_confere('equipe', true);
  perform public.teste_etapa3_staff_escreve('equipe');
end $$;

-- Admin: o mesmo; a auditoria guarda o ator da equipe.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000003a1","role":"authenticated"}';

do $$
begin
  if not public.e_staff() or not public.e_admin() then
    raise exception 'FALHA: funções de papel do admin retornaram valor errado';
  end if;

  perform public.teste_etapa3_confere('admin', true);

  if not exists (
    select 1 from public.auditoria
    where tabela = 'parceiros' and acao = 'INSERT'
      and ator_id = '00000000-0000-0000-0000-0000000003e1'
  ) then
    raise exception 'FALHA: auditoria não registrou o ator da equipe ao inserir em parceiros';
  end if;

  perform public.teste_etapa3_staff_escreve('admin');
end $$;

reset role;

select 'OK: todas as verificações de RLS e de caminhos da Etapa 3 passaram' as resultado;

rollback;
