-- Testes das correções de segurança da Etapa 3 (migration 20261029120000):
-- constraints de link/WhatsApp/nota do Google e storage sem envio pela sessão.
-- Rode depois de aplicar todas as migrations. Como rodar: cole no SQL Editor do
-- Supabase ou use
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/etapa3_correcoes_rls.sql
-- Rode com o usuário postgres. Tudo acontece dentro de uma transação que termina
-- em ROLLBACK, então nada fica no banco (nem as funções auxiliares abaixo). Se
-- alguma verificação falhar, o script para com "FALHA: ..."; se chegar ao fim,
-- imprime "OK" no último select.
-- Os itens de teste têm rótulos começando com "E3C ".

begin;

-- Fixture: conta de equipe.
insert into auth.users (id, aud, role, email)
values ('00000000-0000-0000-0000-0000000003d1', 'authenticated', 'authenticated', 'e3c-equipe-teste@example.com');

insert into public.profiles (id, papel, nome, ativo, precisa_trocar_senha)
values ('00000000-0000-0000-0000-0000000003d1', 'equipe', 'E3C Equipe Teste', true, false);

-- Etapa 8: esta suíte testa a conta de equipe com todas as permissões.
insert into public.equipe_permissoes (profile_id, permissao)
select p.id, c.permissao
from unnest(array['00000000-0000-0000-0000-0000000003d1']::uuid[]) as p(id)
cross join unnest(public.catalogo_permissoes()) with ordinality as c(permissao, ordem)
order by p.id, c.ordem;

-- Dono para os testes de update em loteamentos e arquivo para os de storage.
insert into public.loteamentos (id, nome, slug)
values ('e3c00000-0000-0000-0000-000000000011', 'E3C loteamento', 'e3c-loteamento');

insert into storage.objects (bucket_id, name)
values ('site-publico', 'e3c-teste/fixture.png');

-- Funções auxiliares (somem no rollback). Rodam com o privilégio de quem chama.

-- Cada comando precisa ser barrado por uma CHECK constraint.
create function public.teste_etapa3c_rejeita(p_comandos text[])
returns void
language plpgsql
as $$
declare
  v_sql text;
begin
  foreach v_sql in array p_comandos loop
    begin
      execute v_sql;
      raise exception 'FALHA: constraint aceitou valor inválido: %', v_sql;
    exception when check_violation then
      null;
    end;
  end loop;
end;
$$;

-- Cada comando precisa ser aceito (afetando ao menos uma linha).
create function public.teste_etapa3c_aceita(p_comandos text[])
returns void
language plpgsql
as $$
declare
  v_sql text;
  v_linhas int;
begin
  foreach v_sql in array p_comandos loop
    begin
      execute v_sql;
      get diagnostics v_linhas = row_count;
      if v_linhas < 1 then
        raise exception 'FALHA: comando não afetou nenhuma linha: %', v_sql;
      end if;
    exception when check_violation then
      raise exception 'FALHA: constraint recusou valor válido: %', v_sql;
    end;
  end loop;
end;
$$;

grant execute on function public.teste_etapa3c_rejeita(text[]) to anon, authenticated;
grant execute on function public.teste_etapa3c_aceita(text[]) to anon, authenticated;

-- Como postgres: a migration normalizou o WhatsApp existente para só dígitos e
-- as políticas de envio/atualização do storage foram removidas.
do $$
begin
  if exists (
    select 1 from public.configuracoes_site
    where whatsapp is not null and whatsapp !~ '^[0-9]{10,15}$'
  ) then
    raise exception 'FALHA: configuracoes_site.whatsapp existente não está só em dígitos';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'staff envia arquivos para o site-publico',
        'staff atualiza arquivos do site-publico'
      )
  ) then
    raise exception 'FALHA: políticas de envio/atualização do staff no storage ainda existem';
  end if;
end $$;

-- Equipe: valores inválidos são barrados e válidos aceitos.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000003d1","role":"authenticated"}';

do $$
declare
  v_linhas int;
begin
  if not public.e_staff() then
    raise exception 'FALHA: conta de teste deveria ser staff';
  end if;

  -- banners_hero.botao_href: só caminho relativo ou âncora.
  perform public.teste_etapa3c_rejeita(array[
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C x', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', 'javascript:alert(1)')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C x', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', '//evil.com')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C x', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', 'http://x')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C x', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', 'https://x')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C x', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', ' /x')$q$
  ]);
  perform public.teste_etapa3c_aceita(array[
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C ok 1', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', '/')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C ok 2', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', '/servicos')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C ok 3', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', '#lotes-titulo')$q$,
    $q$insert into public.banners_hero (sobrancelha, titulo, texto, imagem_path, botao_href) values ('x', 'E3C ok 4', 'x', 'hero/11111111-1111-4111-8111-111111111111.webp', null)$q$
  ]);

  -- parceiros.site_url: só https.
  perform public.teste_etapa3c_rejeita(array[
    $q$insert into public.parceiros (nome, logo_path, site_url) values ('E3C x', 'parceiros/11111111-1111-4111-8111-111111111111.webp', 'http://x')$q$,
    $q$insert into public.parceiros (nome, logo_path, site_url) values ('E3C x', 'parceiros/11111111-1111-4111-8111-111111111111.webp', 'javascript:x')$q$
  ]);
  perform public.teste_etapa3c_aceita(array[
    $q$insert into public.parceiros (nome, logo_path, site_url) values ('E3C ok', 'parceiros/11111111-1111-4111-8111-111111111111.webp', 'https://x.com/a')$q$
  ]);

  -- loteamentos.maps_url: só https.
  perform public.teste_etapa3c_rejeita(array[
    $q$update public.loteamentos set maps_url = 'http://x' where id = 'e3c00000-0000-0000-0000-000000000011'$q$,
    $q$insert into public.loteamentos (nome, slug, maps_url) values ('E3C x', 'e3c-x', 'http://x')$q$
  ]);
  perform public.teste_etapa3c_aceita(array[
    $q$update public.loteamentos set maps_url = 'https://x.com/a' where id = 'e3c00000-0000-0000-0000-000000000011'$q$
  ]);

  -- configuracoes_site: WhatsApp só dígitos (10 a 15).
  perform public.teste_etapa3c_rejeita(array[
    $q$update public.configuracoes_site set whatsapp = '+55 33'$q$,
    $q$update public.configuracoes_site set whatsapp = 'abc'$q$,
    $q$update public.configuracoes_site set whatsapp = '123'$q$
  ]);
  perform public.teste_etapa3c_aceita(array[
    $q$update public.configuracoes_site set whatsapp = '5533999439454'$q$
  ]);

  -- configuracoes_site: cada *_url só https.
  perform public.teste_etapa3c_rejeita(array[
    $q$update public.configuracoes_site set instagram_url = 'http://x'$q$,
    $q$update public.configuracoes_site set facebook_url = 'http://x'$q$,
    $q$update public.configuracoes_site set linkedin_url = 'http://x'$q$,
    $q$update public.configuracoes_site set mapa_url = 'http://x'$q$,
    $q$update public.configuracoes_site set google_avaliacoes_url = 'http://x'$q$,
    $q$update public.configuracoes_site set google_avaliar_url = 'http://x'$q$
  ]);
  perform public.teste_etapa3c_aceita(array[
    $q$update public.configuracoes_site set instagram_url = 'https://x.com/a'$q$,
    $q$update public.configuracoes_site set facebook_url = 'https://x.com/a'$q$,
    $q$update public.configuracoes_site set linkedin_url = 'https://x.com/a'$q$,
    $q$update public.configuracoes_site set mapa_url = 'https://x.com/a'$q$,
    $q$update public.configuracoes_site set google_avaliacoes_url = 'https://x.com/a'$q$,
    $q$update public.configuracoes_site set google_avaliar_url = 'https://x.com/a'$q$
  ]);

  -- configuracoes_site: nota do Google de 0 a 5, total >= 0.
  perform public.teste_etapa3c_rejeita(array[
    $q$update public.configuracoes_site set google_nota = 6$q$,
    $q$update public.configuracoes_site set google_total = -1$q$
  ]);
  perform public.teste_etapa3c_aceita(array[
    $q$update public.configuracoes_site set google_nota = 4.9$q$,
    $q$update public.configuracoes_site set google_total = 35$q$
  ]);

  -- Storage: a equipe lê, mas não envia nem altera arquivos pela sessão.
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'site-publico' and name = 'e3c-teste/fixture.png'
  ) then
    raise exception 'FALHA: equipe não conseguiu ler arquivo do bucket site-publico';
  end if;

  begin
    insert into storage.objects (bucket_id, name) values ('site-publico', 'e3c-teste/equipe.png');
    raise exception 'FALHA: equipe conseguiu enviar arquivo para o bucket site-publico';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update storage.objects set metadata = '{"editado":true}'
    where bucket_id = 'site-publico' and name = 'e3c-teste/fixture.png';
    get diagnostics v_linhas = row_count;
    if v_linhas > 0 then
      raise exception 'FALHA: equipe conseguiu alterar arquivo do bucket site-publico';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

select 'OK: todas as verificações das correções da Etapa 3 passaram' as resultado;

rollback;
