-- Etapa 8 — permissões de exclusão: empreendimentos.excluir e fornecedores.excluir (decisão do dono em 09/11 sobre R10 e R11).
-- Aditiva: o catálogo passa de 22 para 24 permissões e três políticas de DELETE saem de e_admin() para tem_permissao().
-- Antes: só o admin apagava empreendimento, fornecedor e contrato de fornecedor. Agora também a equipe com a permissão.
-- fornecedor_documentos continua só do admin; nada mais muda.
-- Única função antiga que muda: salvar_permissoes_equipe (20261105110000), que só tratava dois níveis de dependência.
-- O CHECK equipe_permissoes_permissao_catalogo e os triggers de dependência leem catalogo_permissoes() e
-- prerequisitos_permissao() a cada gravação, então aceitam as permissões novas sem outra mudança.
-- tem_permissao() já devolve verdadeiro para o admin; as políticas não precisam de e_admin() junto.
-- A lista também existe em src/lib/auth/permissoes.ts; scripts/testar-permissoes-catalogo.mjs confere os dois lados.
-- Desfazer: supabase/reversoes/20261109100000_etapa8_permissoes_exclusao.down.sql (fica fora de migrations/ de propósito).

begin;

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
    'empreendimentos.excluir',
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
    'fornecedores.excluir',
    'servidor.regras',
    'painel.servidor'
  ]::text[]
$$;

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
    when p_permissao = 'empreendimentos.excluir' then array['empreendimentos.editar']
    when p_permissao = 'clientes.editar' then array['clientes.ver']
    when p_permissao = 'atualizacoes.editar' then array['atualizacoes.ver']
    when p_permissao = 'documentos.editar' then array['documentos.ver']
    when p_permissao = 'documentos.liberar' then array['documentos.ver']
    when p_permissao = 'financeiro.editar' then array['financeiro.ver']
    when p_permissao = 'obras.editar' then array['obras.ver']
    when p_permissao = 'obras.aprovar' then array['obras.ver']
    when p_permissao = 'fornecedores.editar' then array['fornecedores.ver']
    when p_permissao = 'fornecedores.excluir' then array['fornecedores.editar']
    when p_permissao = 'servidor.regras' then array['empreendimentos.ver']
    else array[]::text[]
  end
$$;

-- Com a exclusão, a cadeia de dependências passa a ter três níveis (ver, editar, excluir). salvar_permissoes_equipe
-- só separava "sem pré-requisito" de "com pré-requisito": numa mesma instrução, apagar ou inserir editar junto com
-- excluir dependia da ordem das linhas, e o trigger de remoção ou de inserção recusava. Agora grava nível a nível.
create function public.nivel_permissao(p_permissao text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_prerequisito text;
  v_nivel integer := 0;
begin
  foreach v_prerequisito in array public.prerequisitos_permissao(p_permissao) loop
    v_nivel := greatest(v_nivel, public.nivel_permissao(v_prerequisito) + 1);
  end loop;
  return v_nivel;
end;
$$;

revoke execute on function public.nivel_permissao(text) from public, anon;
grant execute on function public.nivel_permissao(text) to authenticated;

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
  v_maior integer;
  v_nivel integer;
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

  select coalesce(max(public.nivel_permissao(x.permissao)), 0) into v_maior
  from unnest(public.catalogo_permissoes()) as x(permissao);

  -- O trigger de remoção recusa apagar pré-requisito com dependente: saem primeiro as que ficam mais abaixo na cadeia.
  for v_nivel in reverse v_maior..0 loop
    delete from public.equipe_permissoes e
    where e.profile_id = p_profile_id
      and not (e.permissao = any (v_lista))
      and public.nivel_permissao(e.permissao) = v_nivel;
  end loop;

  -- Linha que já existe não é tocada (sem auditoria nova, mesma concedida_em); o pré-requisito entra antes.
  for v_nivel in 0..v_maior loop
    insert into public.equipe_permissoes (profile_id, permissao)
    select p_profile_id, x.permissao
    from unnest(v_lista) as x(permissao)
    where public.nivel_permissao(x.permissao) = v_nivel
      and not exists (
        select 1 from public.equipe_permissoes e
        where e.profile_id = p_profile_id and e.permissao = x.permissao
      )
    order by x.permissao;
  end loop;
end;
$$;

-- O DELETE de empreendimento leva em cascata empreendimento_clientes, projetos, atualizações, obras,
-- pasta_regras e conector_envios; documentos e itens_financeiros são restrict (o banco já recusa) e
-- fornecedor_contratos e fornecedor_documentos são set null. Quem exclui pode não enxergar essas tabelas:
-- sob RLS a checagem pela sessão voltaria vazia e a cascata apagaria o que ele não vê.
-- Para o admin a checagem é a de sempre (projetos, obras, atualizações, documentos e itens financeiros);
-- vínculos de cliente, regras de pasta, envios do conector e contratos e documentos de fornecedor, que o admin
-- sempre apagou em cascata ou soltou (set null), só travam a exclusão feita pela equipe.
create function public.empreendimento_tem_vinculos(p_empreendimento_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tem_permissao('empreendimentos.excluir')
    and (
      exists (select 1 from public.projetos p where p.empreendimento_id = p_empreendimento_id)
      or exists (select 1 from public.obras o where o.empreendimento_id = p_empreendimento_id)
      or exists (select 1 from public.atualizacoes a where a.empreendimento_id = p_empreendimento_id)
      or exists (select 1 from public.documentos d where d.empreendimento_id = p_empreendimento_id)
      or exists (select 1 from public.itens_financeiros i where i.empreendimento_id = p_empreendimento_id)
      or (
        public.papel_atual() is distinct from 'admin'
        and (
          exists (select 1 from public.empreendimento_clientes c where c.empreendimento_id = p_empreendimento_id)
          or exists (select 1 from public.pasta_regras r where r.empreendimento_id = p_empreendimento_id)
          or exists (select 1 from public.conector_envios e where e.empreendimento_id = p_empreendimento_id)
          or exists (select 1 from public.fornecedor_contratos fc where fc.empreendimento_id = p_empreendimento_id)
          or exists (select 1 from public.fornecedor_documentos fd where fd.empreendimento_id = p_empreendimento_id)
        )
      )
    )
$$;

revoke execute on function public.empreendimento_tem_vinculos(uuid) from public, anon;
grant execute on function public.empreendimento_tem_vinculos(uuid) to authenticated;

drop policy "só o administrador apaga empreendimentos" on public.empreendimentos;

-- A checagem de vínculos também está na política: a rota não é a única porta, a conta da equipe pode chamar o
-- Supabase direto com o próprio token, e a cascata do DELETE ignora o RLS das tabelas filhas. O admin segue
-- sem essa trava no banco (a rota confere antes), como sempre foi.
create policy "empreendimentos.excluir apaga empreendimentos"
  on public.empreendimentos
  for delete
  to authenticated
  using (
    (select public.tem_permissao('empreendimentos.excluir'))
    and (
      (select public.e_admin())
      or not public.empreendimento_tem_vinculos(id)
    )
  );

-- A política acima roda com o snapshot do início do DELETE: um vínculo gravado por outra transação que confirma enquanto
-- o DELETE espera o lock da linha passaria, e a cascata o apagaria. O gatilho BEFORE DELETE roda depois desse lock e,
-- por ser volátil, consulta com snapshot novo, que já enxerga o vínculo confirmado.
create function public.travar_exclusao_empreendimento_com_vinculos()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not (select public.e_admin())
     and public.empreendimento_tem_vinculos(old.id) then
    raise exception 'Remova os registros vinculados antes de excluir.'
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

revoke execute on function public.travar_exclusao_empreendimento_com_vinculos() from public, anon, authenticated;

create trigger travar_exclusao_empreendimento_com_vinculos
  before delete on public.empreendimentos
  for each row execute function public.travar_exclusao_empreendimento_com_vinculos();

drop policy "só o administrador apaga fornecedores" on public.fornecedores;

create policy "fornecedores.excluir apaga fornecedores"
  on public.fornecedores
  for delete
  to authenticated
  using ((select public.tem_permissao('fornecedores.excluir')));

drop policy "só o administrador apaga contratos de fornecedor" on public.fornecedor_contratos;

create policy "fornecedores.excluir apaga contratos de fornecedor"
  on public.fornecedor_contratos
  for delete
  to authenticated
  using ((select public.tem_permissao('fornecedores.excluir')));

commit;
