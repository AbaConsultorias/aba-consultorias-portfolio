-- Desfaz supabase/migrations/20261106110000_etapa8_rls_clientes_financeiro.sql.
-- Políticas e funções voltam ao texto de produção de docs/etapa8-estado-banco-antes-rls.json.
-- As funções excluir_item_financeiro_portal, nome_empreendimento, nome_fornecedor e nome_pessoa
-- tinham fim de linha CRLF no corpo; o replace(chr(10), chr(13) || chr(10)) devolve o prosrc byte a byte.

begin;

-- Funções

do $reverter$
begin
  execute replace($def$
create or replace function public.excluir_item_financeiro_portal(p_item uuid)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
declare v_id uuid;
begin
  if not public.e_staff() then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  -- O item é trancado primeiro (a inclusão concorrente de parcela espera) e as parcelas depois (o
  -- pagamento concorrente espera): a checagem e o cascade enxergam o mesmo estado.
  select id into v_id from public.itens_financeiros where id = p_item for update;
  if not found then return null; end if;
  perform 1 from public.parcelas where item_id = p_item for update;
  if exists (select 1 from public.parcelas where item_id = p_item and (data_pagamento is not null or valor_pago_centavos > 0)) then
    raise exception 'Item com pagamento registrado.' using errcode = '23503';
  end if;
  delete from public.itens_financeiros where id = p_item;
  return v_id;
end $function$
$def$, chr(10), chr(13) || chr(10));

  execute replace($def$
create or replace function public.nome_empreendimento(p_empreendimento uuid)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select e.nome
  from public.empreendimentos e
  where e.id = p_empreendimento
    and (
      public.e_staff()
      or public.cliente_do_empreendimento(e.id)
      or exists (
        select 1
        from public.obras o
        where o.empreendimento_id = e.id
          and public.empreiteiro_da_obra(o.id)
      )
      or exists (
        select 1
        from public.itens_financeiros i
        where i.empreendimento_id = e.id
          and i.fornecedor_id is not null
          and public.usuario_do_fornecedor(i.fornecedor_id)
      )
    )
$function$
$def$, chr(10), chr(13) || chr(10));

  execute replace($def$
create or replace function public.nome_fornecedor(p_fornecedor uuid)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(f.nome_fantasia, f.razao_social)
  from public.fornecedores f
  where f.id = p_fornecedor
    and (
      public.e_staff()
      or public.usuario_do_fornecedor(f.id)
      or exists (
        select 1
        from public.itens_financeiros i
        where i.fornecedor_id = f.id
          and public.cliente_do_empreendimento(i.empreendimento_id)
      )
    )
$function$
$def$, chr(10), chr(13) || chr(10));

  execute replace($def$
create or replace function public.nome_pessoa(p_profile uuid)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select p.nome
  from public.profiles p
  where p.id = p_profile
    and (
      public.e_staff()
      or (p.id = (select auth.uid()) and public.papel_atual() is not null)
      or (
        public.papel_atual() = 'cliente'
        and exists (
          select 1
          from public.obra_empreiteiros oe
          join public.obras o on o.id = oe.obra_id
          where oe.profile_id = p.id
            and public.cliente_do_empreendimento(o.empreendimento_id)
        )
      )
    )
$function$
$def$, chr(10), chr(13) || chr(10));
end
$reverter$;

-- parcelas

drop policy "financeiro.editar insere parcelas" on public.parcelas;
drop policy "financeiro.editar atualiza parcelas" on public.parcelas;
drop policy "financeiro.editar apaga parcelas" on public.parcelas;

create policy "staff insere parcelas"
  on public.parcelas
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza parcelas"
  on public.parcelas
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga parcelas"
  on public.parcelas
  for delete
  to authenticated
  using ((select public.e_staff()));

-- itens_financeiros

drop policy "financeiro.ver, clientes e fornecedor do item leem itens" on public.itens_financeiros;
drop policy "financeiro.editar insere itens financeiros" on public.itens_financeiros;
drop policy "financeiro.editar atualiza itens financeiros" on public.itens_financeiros;
drop policy "financeiro.editar apaga itens financeiros" on public.itens_financeiros;

create policy "staff, clientes e fornecedor do item leem itens financeiros"
  on public.itens_financeiros
  for select
  to authenticated
  using (
    (select public.e_staff())
    or public.cliente_do_empreendimento(empreendimento_id)
    or (fornecedor_id is not null and public.usuario_do_fornecedor(fornecedor_id))
  );

create policy "staff insere itens financeiros"
  on public.itens_financeiros
  for insert
  to authenticated
  with check ((select public.e_staff()));

create policy "staff atualiza itens financeiros"
  on public.itens_financeiros
  for update
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

create policy "staff apaga itens financeiros"
  on public.itens_financeiros
  for delete
  to authenticated
  using ((select public.e_staff()));

-- empreendimento_clientes

drop policy "clientes.ver lê clientes de empreendimento" on public.empreendimento_clientes;
drop policy "clientes.editar insere clientes de empreendimento" on public.empreendimento_clientes;
drop policy "clientes.editar atualiza clientes de empreendimento" on public.empreendimento_clientes;
drop policy "clientes.editar apaga clientes de empreendimento" on public.empreendimento_clientes;

create policy "staff gerencia clientes de empreendimento"
  on public.empreendimento_clientes
  for all
  to authenticated
  using ((select public.e_staff()))
  with check ((select public.e_staff()));

-- profiles

drop policy "admin lê todos os perfis, equipe lê por tipo de conta" on public.profiles;

create policy "staff lê todos os perfis"
  on public.profiles
  for select
  to authenticated
  using ((select public.e_staff()));

create or replace function public.validar_insercao_equipe_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_faltando text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.profile_id::text, 0));

  new.concedida_por := (select auth.uid());
  new.concedida_em := now();

  if not exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.papel = 'equipe'
  ) then
    raise exception 'Só contas da equipe podem receber permissões.'
      using errcode = 'check_violation';
  end if;

  select pre.permissao into v_faltando
  from unnest(public.prerequisitos_permissao(new.permissao)) as pre(permissao)
  where not exists (
    select 1 from public.equipe_permissoes e
    where e.profile_id = new.profile_id and e.permissao = pre.permissao
  )
  limit 1;

  if found then
    raise exception 'Para conceder "%", a permissão "%" precisa ser concedida antes.', new.permissao, v_faltando
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

alter function public.validar_vinculos_portal() security invoker;
alter function public.validar_insercao_equipe_permissao() security invoker;
alter function public.validar_remocao_equipe_permissao() security invoker;

commit;
