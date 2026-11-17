begin;

-- Criar e vincular ao projeto pai numa transação só: o INSERT já grava projeto_pai_id e a trigger
-- validar_hierarquia_projetos valida no mesmo comando, sem sobrar projeto órfão se o vínculo falhar.
drop function public.criar_projeto_de_modelo(uuid, uuid, text);

create function public.criar_projeto_de_modelo(
  p_empreendimento uuid,
  p_modelo uuid,
  p_nome text,
  p_projeto_pai uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_projeto uuid;
  v_primeira_etapa uuid;
begin
  if not public.e_staff() then
    raise exception 'Apenas a equipe pode criar projetos.' using errcode = 'insufficient_privilege';
  end if;

  if p_modelo is null then
    raise exception 'O modelo do projeto é obrigatório.' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.projetos (empreendimento_id, modelo_origem_id, nome, projeto_pai_id)
  values (p_empreendimento, p_modelo, p_nome, p_projeto_pai)
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
$$;

revoke execute on function public.criar_projeto_de_modelo(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.criar_projeto_de_modelo(uuid, uuid, text, uuid) to authenticated;

commit;
