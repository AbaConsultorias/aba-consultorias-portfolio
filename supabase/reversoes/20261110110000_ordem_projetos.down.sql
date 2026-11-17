-- Desfaz supabase/migrations/20261110110000_ordem_projetos.sql: volta criar_projeto_de_modelo ao texto de
-- 20261106120000_etapa8_rls_andamento_obras.sql e tira a ordem dos projetos (função, trigger, índice e coluna).
-- O código que lê, grava e mostra projetos.ordem (rota de ordem, árvore do admin, portal do cliente) precisa voltar
-- junto: ele consulta a coluna. Rode à mão, com o usuário postgres.
-- Perda de dado: a ordem escolhida pela equipe é descartada; a lista volta a ser alfabética.

begin;

drop function public.reordenar_projetos(uuid, uuid, uuid[]);

drop trigger projetos_ordem_ao_mudar_pai on public.projetos;
drop function public.projetos_ordem_ao_mudar_pai();

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
$function$;

drop index public.projetos_ordem_idx;

alter table public.projetos
  drop constraint projetos_ordem_check,
  drop column ordem;

commit;
