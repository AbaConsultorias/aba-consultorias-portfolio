-- Desfaz supabase/migrations/20261109100000_etapa8_permissoes_exclusao.sql: volta ao catálogo de 22 permissões
-- e ao DELETE só do admin em empreendimentos, fornecedores e fornecedor_contratos.
-- O código que usa as permissões e a função de vínculos precisa voltar junto. Rode à mão, com o usuário postgres.
-- As linhas de equipe_permissoes com as permissões novas são apagadas antes de o catálogo voltar a 22,
-- senão ficariam gravadas fora do catálogo. Nada além disso em equipe_permissoes é tocado.

begin;

drop policy "empreendimentos.excluir apaga empreendimentos" on public.empreendimentos;

create policy "só o administrador apaga empreendimentos"
  on public.empreendimentos
  for delete
  to authenticated
  using ((select public.e_admin()));

drop policy "fornecedores.excluir apaga fornecedores" on public.fornecedores;

create policy "só o administrador apaga fornecedores"
  on public.fornecedores
  for delete
  to authenticated
  using ((select public.e_admin()));

drop policy "fornecedores.excluir apaga contratos de fornecedor" on public.fornecedor_contratos;

create policy "só o administrador apaga contratos de fornecedor"
  on public.fornecedor_contratos
  for delete
  to authenticated
  using ((select public.e_admin()));

drop trigger travar_exclusao_empreendimento_com_vinculos on public.empreendimentos;
drop function public.travar_exclusao_empreendimento_com_vinculos();

drop function public.empreendimento_tem_vinculos(uuid);

delete from public.equipe_permissoes
where permissao in ('empreendimentos.excluir', 'fornecedores.excluir');

create or replace function public.salvar_permissoes_equipe(p_profile_id uuid, p_permissoes text[])
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

drop function public.nivel_permissao(text);

create or replace function public.prerequisitos_permissao(p_permissao text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_permissao = 'site.editar' then array['site.ver']
    when p_permissao = 'contatos.editar' then array['contatos.ver']
    when p_permissao = 'empreendimentos.editar' then array['empreendimentos.ver']
    when p_permissao = 'clientes.editar' then array['clientes.ver']
    when p_permissao = 'atualizacoes.editar' then array['atualizacoes.ver']
    when p_permissao = 'documentos.editar' then array['documentos.ver']
    when p_permissao = 'documentos.liberar' then array['documentos.ver']
    when p_permissao = 'financeiro.editar' then array['financeiro.ver']
    when p_permissao = 'obras.editar' then array['obras.ver']
    when p_permissao = 'obras.aprovar' then array['obras.ver']
    when p_permissao = 'fornecedores.editar' then array['fornecedores.ver']
    when p_permissao = 'servidor.regras' then array['empreendimentos.ver']
    else array[]::text[]
  end
$$;

create or replace function public.catalogo_permissoes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'site.ver',
    'site.editar',
    'contatos.ver',
    'contatos.editar',
    'empreendimentos.ver',
    'empreendimentos.editar',
    'clientes.ver',
    'clientes.editar',
    'atualizacoes.ver',
    'atualizacoes.editar',
    'documentos.ver',
    'documentos.editar',
    'documentos.liberar',
    'financeiro.ver',
    'financeiro.editar',
    'obras.ver',
    'obras.editar',
    'obras.aprovar',
    'fornecedores.ver',
    'fornecedores.editar',
    'servidor.regras',
    'painel.servidor'
  ]::text[]
$$;

commit;
