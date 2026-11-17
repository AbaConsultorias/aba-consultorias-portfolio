-- Etapa 8, onda 2 — contas internas: proteção do último admin, listagem e gravação das permissões da equipe.
-- Contrato: docs/ETAPA-8-CONTRATO.md §5 e §6. Depende de 20261105100000_etapa8_permissoes.sql.
-- Nenhuma política, função ou trigger existente é alterada: só entram um trigger e duas funções novas.
-- Desfazer: supabase/reversoes/20261105110000_etapa8_contas_internas.down.sql (fica fora de migrations/ de propósito).

begin;

-- O banco recusa desativar, rebaixar ou apagar o último admin ativo, para qualquer papel de banco
-- (inclusive a secret key e o postgres). Security definer porque quem escreve em profiles pode não
-- enxergar os outros admins pelo RLS, e a contagem precisa considerar todos. O lock fixo serializa
-- duas saídas simultâneas: sem ele, dois admins se desativando ao mesmo tempo passariam os dois pela checagem.
create function public.proteger_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.papel = 'admin'
     and old.ativo
     and (tg_op = 'DELETE' or new.papel <> 'admin' or new.ativo is not true) then
    perform pg_advisory_xact_lock(hashtextextended('profiles.ultimo_admin', 0));

    if not exists (
      select 1
      from public.profiles p
      where p.papel = 'admin'
        and p.ativo
        and p.id <> old.id
    ) then
      raise exception 'Não é possível desativar, rebaixar ou apagar o último administrador ativo.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_ultimo_admin() from public, anon, authenticated;

create trigger profiles_proteger_ultimo_admin
  before update or delete on public.profiles
  for each row execute function public.proteger_ultimo_admin();

-- Security definer para ler auth.users (e-mail e último acesso), que nenhum papel de aplicação enxerga.
-- A checagem de admin vem antes de qualquer leitura: quem não é admin recebe só o erro.
create function public.listar_contas_internas()
returns table (
  id uuid,
  nome text,
  telefone text,
  papel text,
  ativo boolean,
  precisa_trocar_senha boolean,
  identificador text,
  ultimo_acesso timestamptz,
  permissoes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.e_admin()), false) then
    raise exception 'Só administradores podem listar as contas internas.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.nome,
    p.telefone,
    p.papel::text,
    p.ativo,
    p.precisa_trocar_senha,
    u.email::text,
    u.last_sign_in_at,
    coalesce(
      (select array_agg(e.permissao order by e.permissao)
       from public.equipe_permissoes e
       where e.profile_id = p.id),
      array[]::text[]
    )
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.papel in ('admin', 'equipe')
  order by p.nome, p.id;
end;
$$;

-- Security invoker de propósito: a sessão do admin passa pelo RLS e pelos triggers de equipe_permissoes
-- (pré-requisitos, auditoria com o ator verdadeiro, concedida_por). A função só decide a ordem das
-- gravações e roda numa chamada só: qualquer recusa desfaz tudo.
create function public.salvar_permissoes_equipe(p_profile_id uuid, p_permissoes text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_lista text[];
  v_invalida text;
  v_dependente text;
  v_faltando text;
begin
  if not coalesce((select public.e_admin()), false) then
    raise exception 'Só administradores podem salvar as permissões da equipe.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_permissoes is null then
    raise exception 'A lista de permissões não pode ser nula.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from unnest(p_permissoes) as x(permissao) where x.permissao is null) then
    raise exception 'A lista de permissões não pode conter itens nulos.'
      using errcode = 'check_violation';
  end if;

  v_lista := array(select distinct x.permissao from unnest(p_permissoes) as x(permissao));

  select x.permissao into v_invalida
  from unnest(v_lista) as x(permissao)
  where not (x.permissao = any (public.catalogo_permissoes()))
  order by x.permissao
  limit 1;

  if found then
    raise exception 'A permissão "%" não existe no catálogo.', v_invalida
      using errcode = 'check_violation';
  end if;

  select x.permissao, pre.permissao into v_dependente, v_faltando
  from unnest(v_lista) as x(permissao)
  cross join lateral unnest(public.prerequisitos_permissao(x.permissao)) as pre(permissao)
  where not (pre.permissao = any (v_lista))
  order by x.permissao, pre.permissao
  limit 1;

  if found then
    raise exception 'Para "%", a lista também precisa conter "%".', v_dependente, v_faltando
      using errcode = 'check_violation';
  end if;

  -- Mesmo lock por perfil dos triggers de equipe_permissoes: duas gravações do mesmo perfil esperam uma pela outra.
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));

  if not exists (
    select 1 from public.profiles p where p.id = p_profile_id and p.papel = 'equipe'
  ) then
    raise exception 'Só contas da equipe podem receber permissões.'
      using errcode = 'check_violation';
  end if;

  -- O trigger de remoção recusa apagar pré-requisito com dependente: saem primeiro as que dependem de outra.
  delete from public.equipe_permissoes e
  where e.profile_id = p_profile_id
    and not (e.permissao = any (v_lista))
    and cardinality(public.prerequisitos_permissao(e.permissao)) > 0;

  delete from public.equipe_permissoes e
  where e.profile_id = p_profile_id
    and not (e.permissao = any (v_lista));

  -- Linha que já existe não é tocada (sem auditoria nova, mesma concedida_em); o pré-requisito entra antes.
  insert into public.equipe_permissoes (profile_id, permissao)
  select p_profile_id, x.permissao
  from unnest(v_lista) as x(permissao)
  where cardinality(public.prerequisitos_permissao(x.permissao)) = 0
    and not exists (
      select 1 from public.equipe_permissoes e
      where e.profile_id = p_profile_id and e.permissao = x.permissao
    )
  order by x.permissao;

  insert into public.equipe_permissoes (profile_id, permissao)
  select p_profile_id, x.permissao
  from unnest(v_lista) as x(permissao)
  where cardinality(public.prerequisitos_permissao(x.permissao)) > 0
    and not exists (
      select 1 from public.equipe_permissoes e
      where e.profile_id = p_profile_id and e.permissao = x.permissao
    )
  order by x.permissao;
end;
$$;

revoke execute on function public.listar_contas_internas() from public, anon;
revoke execute on function public.salvar_permissoes_equipe(uuid, text[]) from public, anon;
grant execute on function public.listar_contas_internas() to authenticated;
grant execute on function public.salvar_permissoes_equipe(uuid, text[]) to authenticated;

commit;
