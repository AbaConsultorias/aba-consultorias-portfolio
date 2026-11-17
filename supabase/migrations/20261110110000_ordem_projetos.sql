-- Ordem dos projetos de cada empreendimento (decisão do dono em 09/11/2026).
-- 1. projetos.ordem: posição do projeto entre os irmãos (mesmo empreendimento e mesmo "depende de"). A equipe
--    define; o cliente vê nessa ordem. Antes a lista era alfabética: o preenchimento abaixo copia essa ordem, então
--    nada muda de lugar no deploy.
-- 2. Projeto novo (criar_projeto_de_modelo) e projeto que troca de pai entram no fim dos irmãos.
-- 3. reordenar_projetos: grava a ordem de todos os irmãos de uma vez, só com empreendimentos.editar.
-- Aditiva: nenhuma política de RLS muda (o UPDATE passa pela política "empreendimentos.editar atualiza projetos") e
-- os triggers de auditoria e de hierarquia continuam valendo.
-- Desfazer: supabase/reversoes/20261110110000_ordem_projetos.down.sql.
begin;

-- ---------------------------------------------------------------------------
-- 1. Coluna, índice e preenchimento
-- ---------------------------------------------------------------------------

alter table public.projetos
  add column ordem integer not null default 0,
  add constraint projetos_ordem_check check (ordem >= 0);

create index projetos_ordem_idx on public.projetos (empreendimento_id, projeto_pai_id, ordem);

-- Preenchimento com os triggers ligados (auditoria e atualizado_em valem também aqui): são poucos projetos.
update public.projetos p
set ordem = s.posicao
from (
  select q.id, (row_number() over (partition by q.empreendimento_id, q.projeto_pai_id order by q.nome, q.id) - 1)::integer as posicao
  from public.projetos q
) s
where s.id = p.id;

-- ---------------------------------------------------------------------------
-- 2. Projeto novo e troca de pai: fim dos irmãos
-- ---------------------------------------------------------------------------

-- Mesma função de 20261106120000_etapa8_rls_andamento_obras.sql (assinatura, permissão e grants iguais);
-- a única mudança é gravar a ordem no INSERT. Dois projetos criados ao mesmo tempo podem ficar com a mesma
-- ordem: o desempate é por nome e id, e a equipe acerta com reordenar_projetos.
create or replace function public.criar_projeto_de_modelo(p_empreendimento uuid, p_modelo uuid, p_nome text, p_projeto_pai uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 set search_path to ''
as $function$
declare
  v_projeto uuid;
  v_primeira_etapa uuid;
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Apenas a equipe pode criar projetos.' using errcode = 'insufficient_privilege';
  end if;

  if p_modelo is null then
    raise exception 'O modelo do projeto é obrigatório.' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.projetos (empreendimento_id, modelo_origem_id, nome, projeto_pai_id, ordem)
  values (
    p_empreendimento, p_modelo, p_nome, p_projeto_pai,
    coalesce((
      select max(i.ordem) from public.projetos i
      where i.empreendimento_id = p_empreendimento and i.projeto_pai_id is not distinct from p_projeto_pai
    ), -1) + 1
  )
  returning id into v_projeto;

  insert into public.projeto_etapas (projeto_id, nome, ordem)
  select v_projeto, i.nome, i.ordem
  from public.modelo_etapas_itens i
  where i.modelo_id = p_modelo;

  insert into public.projeto_categorias_documento (projeto_id, nome, ordem)
  select v_projeto, c.nome, c.ordem
  from public.modelo_categorias_documento c
  where c.modelo_id = p_modelo;

  select e.id into v_primeira_etapa
  from public.projeto_etapas e
  where e.projeto_id = v_projeto
  order by e.ordem
  limit 1;

  update public.projetos
  set etapa_atual_id = v_primeira_etapa
  where id = v_projeto;

  return v_projeto;
end;
$function$;

-- Também dispara quando o pai some (a chave estrangeira faz set null): os dependentes viram raízes no fim das
-- raízes, em ordem que não é garantida; a equipe reordena. Roda antes de projetos_validar_hierarquia (ordem
-- alfabética dos nomes); se a hierarquia recusar, a instrução toda é desfeita.
create function public.projetos_ordem_ao_mudar_pai()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.projeto_pai_id is not distinct from old.projeto_pai_id then
    return new;
  end if;

  select coalesce(max(i.ordem), -1) + 1 into new.ordem
  from public.projetos i
  where i.empreendimento_id = new.empreendimento_id
    and i.projeto_pai_id is not distinct from new.projeto_pai_id
    and i.id <> new.id;

  return new;
end;
$$;

revoke execute on function public.projetos_ordem_ao_mudar_pai() from public, anon, authenticated;

create trigger projetos_ordem_ao_mudar_pai
  before update of projeto_pai_id on public.projetos
  for each row execute function public.projetos_ordem_ao_mudar_pai();

-- ---------------------------------------------------------------------------
-- 3. Reordenar os irmãos
-- ---------------------------------------------------------------------------

-- Security invoker de propósito, como criar_projeto_de_modelo: o UPDATE passa pelo RLS e pelos triggers.
-- p_ids precisa ser exatamente a lista dos irmãos (mesmo empreendimento e mesmo pai; p_pai nulo = raízes),
-- sem faltar, sobrar nem repetir; a posição na lista vira a ordem (0, 1, 2...).
create function public.reordenar_projetos(p_empreendimento uuid, p_pai uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_irmaos uuid[];
begin
  if not (select public.tem_permissao('empreendimentos.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_empreendimento is null or coalesce(cardinality(p_ids), 0) = 0
    or exists (select 1 from unnest(p_ids) as x(id) where x.id is null)
    or (select count(distinct x.id) from unnest(p_ids) as x(id)) <> cardinality(p_ids) then
    raise exception 'A lista de projetos é inválida.' using errcode = '22023';
  end if;

  select array_agg(l.id order by l.id) into v_irmaos
  from (
    select p.id
    from public.projetos p
    where p.empreendimento_id = p_empreendimento and p.projeto_pai_id is not distinct from p_pai
    order by p.id
    for update
  ) l;

  if v_irmaos is distinct from (select array_agg(x.id order by x.id) from unnest(p_ids) as x(id)) then
    raise exception 'A lista de projetos não confere com os projetos deste nível.' using errcode = '22023';
  end if;

  update public.projetos p
  set ordem = (t.posicao - 1)::integer
  from unnest(p_ids) with ordinality as t(id, posicao)
  where p.id = t.id and p.ordem is distinct from (t.posicao - 1)::integer;
end;
$$;

revoke execute on function public.reordenar_projetos(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.reordenar_projetos(uuid, uuid, uuid[]) to authenticated;

commit;
