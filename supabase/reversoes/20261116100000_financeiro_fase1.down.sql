-- Desfaz supabase/migrations/20261116100000_financeiro_fase1.sql: apaga as funções, os triggers, as tabelas
-- financeiro_eventos e item_financeiro_projetos e as colunas novas de itens_financeiros e parcelas.
-- O código que usa o financeiro por eventos (rotas, telas, "A cobrar") precisa voltar junto.
-- Rode à mão, com o usuário postgres.
-- Perda de dados: eventos, projetos dos contratos, código, versão, data de assinatura e PDF dos contratos, e o gatilho
-- das parcelas (nome, valor e pagamento ficam). O vencimento de parcela por evento fica como estava no último cálculo.
-- Recusa rodar se houver parcela sem vencimento (aguardando evento): a coluna voltaria a ser obrigatória e essas parcelas
-- perderiam o único jeito de saber quando vencem. Resolva antes (apague a parcela ou marque o evento) e rode de novo.

begin;

do $$
begin
  if exists (select 1 from public.parcelas where vencimento is null) then
    raise exception 'Há parcelas sem vencimento (aguardando evento). Marque os eventos ou apague essas parcelas antes de desfazer a fase 1 do financeiro.';
  end if;
end
$$;

drop trigger projeto_etapa_historico_desfazer_eventos_financeiros on public.projeto_etapa_historico;
drop trigger projeto_etapa_historico_eventos_financeiros on public.projeto_etapa_historico;
drop function public.financeiro_desfazer_eventos_do_historico();
drop function public.financeiro_eventos_do_historico();

drop function public.financeiro_eventos_retroativos();
drop function public.listar_a_cobrar(integer);
drop function public.salvar_contrato_portal(uuid, uuid, jsonb, timestamptz);
drop function public.desfazer_evento_financeiro(uuid);
drop function public.marcar_evento_financeiro(uuid, text, date, uuid, uuid, uuid, boolean);
drop function public.financeiro_recalcular_vencimentos(uuid);

drop trigger parcelas_proteger_evento on public.parcelas;
drop function public.proteger_parcela_evento();

-- evento_id é a única coluna de parcelas que aponta para financeiro_eventos: sai antes da tabela.
alter table public.parcelas
  drop constraint parcelas_item_numero_key,
  drop constraint parcelas_evento_projeto_tipo_check,
  drop constraint parcelas_evento_descricao_so_outro_check,
  drop constraint parcelas_gatilho_evento_check,
  drop constraint parcelas_gatilho_data_check,
  drop constraint parcelas_dias_apos_check,
  drop constraint parcelas_evento_descricao_check,
  drop constraint parcelas_evento_tipo_check,
  drop constraint parcelas_gatilho_check,
  drop constraint parcelas_numero_check;

drop index public.parcelas_evento_id_idx;
drop index public.parcelas_evento_projeto_id_idx;

alter table public.parcelas
  drop column evento_id,
  drop column dias_apos,
  drop column evento_descricao,
  drop column evento_projeto_id,
  drop column evento_tipo,
  drop column gatilho,
  drop column numero,
  alter column vencimento set not null;

drop table public.financeiro_eventos;
drop table public.item_financeiro_projetos;
drop function public.validar_item_financeiro_projeto();

drop trigger itens_financeiros_validar_contrato on public.itens_financeiros;
drop function public.validar_item_financeiro_contrato();

drop index public.itens_financeiros_codigo_idx;
drop index public.itens_financeiros_documento_id_idx;

alter table public.itens_financeiros
  drop constraint itens_financeiros_fornecedor_sem_contrato_check,
  drop constraint itens_financeiros_versao_check,
  drop constraint itens_financeiros_codigo_check,
  drop column documento_id,
  drop column assinado_em,
  drop column versao,
  drop column codigo;

drop function public.financeiro_ler_uuid(text);
drop function public.financeiro_ler_data(text);
drop function public.financeiro_json_vazio(jsonb);
drop function public.financeiro_json_texto(jsonb);
drop function public.financeiro_texto_simples(text);

commit;
