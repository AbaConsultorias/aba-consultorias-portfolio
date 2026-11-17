-- Etapa 8, onda 4 (1 de 3) — RLS de clientes e financeiro sai de e_staff() para tem_permissao().
-- Contrato: docs/ETAPA-8-CONTRATO.md §4; anexo: Resoluções R15, R16 e Parte D (Tabelas 1 e 2).
-- Cobre: profiles, empreendimento_clientes, itens_financeiros, parcelas e as funções
-- excluir_item_financeiro_portal, nome_pessoa, nome_fornecedor e nome_empreendimento.
-- Ramos de cliente, empreiteiro e fornecedor ficam com o texto de antes. Admin passa por tem_permissao.
-- Desfazer: supabase/reversoes/20261106110000_etapa8_rls_clientes_financeiro.down.sql.

begin;

-- ---------------------------------------------------------------------------
-- profiles (R16): a equipe lê o perfil pelo tipo da linha. Conta interna só o admin lê; a própria
-- linha segue pela política "usuário lê o próprio perfil". Os triggers validar_vinculos_* leem
-- profiles com o RLS de quem grava: editar implica ver, então o vínculo continua enxergando a conta.
-- ---------------------------------------------------------------------------

drop policy "staff lê todos os perfis" on public.profiles;

create policy "admin lê todos os perfis, equipe lê por tipo de conta"
  on public.profiles
  for select
  to authenticated
  using (
    (select public.e_admin())
    or (papel = 'cliente' and (select public.tem_permissao('clientes.ver')))
    or (papel = 'empreiteiro' and (select public.tem_permissao('obras.ver')))
    or (papel = 'fornecedor' and (select public.tem_permissao('fornecedores.ver')))
  );

-- ---------------------------------------------------------------------------
-- empreendimento_clientes
-- ---------------------------------------------------------------------------

drop policy "staff gerencia clientes de empreendimento" on public.empreendimento_clientes;

create policy "clientes.ver lê clientes de empreendimento"
  on public.empreendimento_clientes
  for select
  to authenticated
  using ((select public.tem_permissao('clientes.ver')));

create policy "clientes.editar insere clientes de empreendimento"
  on public.empreendimento_clientes
  for insert
  to authenticated
  with check ((select public.tem_permissao('clientes.editar')));

create policy "clientes.editar atualiza clientes de empreendimento"
  on public.empreendimento_clientes
  for update
  to authenticated
  using ((select public.tem_permissao('clientes.editar')))
  with check ((select public.tem_permissao('clientes.editar')));

create policy "clientes.editar apaga clientes de empreendimento"
  on public.empreendimento_clientes
  for delete
  to authenticated
  using ((select public.tem_permissao('clientes.editar')));

-- ---------------------------------------------------------------------------
-- itens_financeiros
-- ---------------------------------------------------------------------------

drop policy "staff, clientes e fornecedor do item leem itens financeiros" on public.itens_financeiros;
drop policy "staff insere itens financeiros" on public.itens_financeiros;
drop policy "staff atualiza itens financeiros" on public.itens_financeiros;
drop policy "staff apaga itens financeiros" on public.itens_financeiros;

create policy "financeiro.ver, clientes e fornecedor do item leem itens"
  on public.itens_financeiros
  for select
  to authenticated
  using (
    (select public.tem_permissao('financeiro.ver'))
    or public.cliente_do_empreendimento(empreendimento_id)
    or (fornecedor_id is not null and public.usuario_do_fornecedor(fornecedor_id))
  );

create policy "financeiro.editar insere itens financeiros"
  on public.itens_financeiros
  for insert
  to authenticated
  with check ((select public.tem_permissao('financeiro.editar')));

create policy "financeiro.editar atualiza itens financeiros"
  on public.itens_financeiros
  for update
  to authenticated
  using ((select public.tem_permissao('financeiro.editar')))
  with check ((select public.tem_permissao('financeiro.editar')));

create policy "financeiro.editar apaga itens financeiros"
  on public.itens_financeiros
  for delete
  to authenticated
  using ((select public.tem_permissao('financeiro.editar')));

-- ---------------------------------------------------------------------------
-- parcelas: a leitura continua herdada de itens_financeiros ("quem lê o item financeiro lê as parcelas").
-- ---------------------------------------------------------------------------

drop policy "staff insere parcelas" on public.parcelas;
drop policy "staff atualiza parcelas" on public.parcelas;
drop policy "staff apaga parcelas" on public.parcelas;

create policy "financeiro.editar insere parcelas"
  on public.parcelas
  for insert
  to authenticated
  with check ((select public.tem_permissao('financeiro.editar')));

create policy "financeiro.editar atualiza parcelas"
  on public.parcelas
  for update
  to authenticated
  using ((select public.tem_permissao('financeiro.editar')))
  with check ((select public.tem_permissao('financeiro.editar')));

create policy "financeiro.editar apaga parcelas"
  on public.parcelas
  for delete
  to authenticated
  using ((select public.tem_permissao('financeiro.editar')));

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------

create or replace function public.excluir_item_financeiro_portal(p_item uuid)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
declare v_id uuid;
begin
  if not (select public.tem_permissao('financeiro.editar')) then raise exception 'Acesso negado.' using errcode = '42501'; end if;
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
end $function$;

-- R15: nome de admin e de equipe só para o admin; os demais perfis, pela permissão do tipo de conta.
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
      (select public.e_admin())
      or (p.papel = 'cliente' and (select public.tem_permissao('clientes.ver')))
      or (p.papel = 'empreiteiro' and (select public.tem_permissao('obras.ver')))
      or (p.papel = 'fornecedor' and (select public.tem_permissao('fornecedores.ver')))
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
$function$;

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
      (select public.tem_permissao('fornecedores.ver'))
      or (select public.tem_permissao('financeiro.ver'))
      or public.usuario_do_fornecedor(f.id)
      or exists (
        select 1
        from public.itens_financeiros i
        where i.fornecedor_id = f.id
          and public.cliente_do_empreendimento(i.empreendimento_id)
      )
    )
$function$;

-- Só o nome: toda tela interna que mostra o empreendimento de outro módulo passa por aqui.
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
      (select public.tem_permissao('empreendimentos.ver'))
      or (select public.tem_permissao('clientes.ver'))
      or (select public.tem_permissao('atualizacoes.ver'))
      or (select public.tem_permissao('documentos.ver'))
      or (select public.tem_permissao('financeiro.ver'))
      or (select public.tem_permissao('obras.ver'))
      or (select public.tem_permissao('fornecedores.ver'))
      or (select public.tem_permissao('painel.servidor'))
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
$function$;

-- Estes triggers só conferem vínculos e dependências e precisam enxergar linhas de outro módulo. Como invoker,
-- quem tem atualizacoes.editar falharia no "for update" de projetos, e a negação de quem não é admin viraria
-- uma mensagem sobre o papel do alvo em vez de falta de permissão.
create or replace function public.validar_insercao_equipe_permissao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_faltando text;
begin
  -- Sessão sem usuário é a secret key ou um script; com usuário, só o admin passa. A recusa vem antes de
  -- qualquer leitura: como definer, as mensagens abaixo revelariam dados que quem chama não enxerga.
  if (select auth.uid()) is not null and not (select public.e_admin()) then
    raise exception 'Só administradores podem conceder permissões.'
      using errcode = 'insufficient_privilege';
  end if;

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

alter function public.validar_vinculos_portal() security definer;
alter function public.validar_insercao_equipe_permissao() security definer;
alter function public.validar_remocao_equipe_permissao() security definer;

commit;
