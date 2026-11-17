import "server-only";
import z from "zod";
import { BadRequestError, ConflictError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { CAMPOS_PARCELA, parcelaSchema } from "@/lib/portal/financeiro/campos";
import { conferirErro, exigirRegistro } from "@/lib/portal/financeiro/erros";
import type { Pagina } from "@/lib/portal/comum/tipos";
import type { ParcelaPortal } from "@/lib/portal/financeiro/tipos";
import type { AtualizarInput, ConsultaInput, CriarInput } from "./schema";

const CAMPOS_COM_OBSERVACAO = `${CAMPOS_PARCELA},observacao`;
const comObservacao = parcelaSchema.extend({ observacao: z.string().nullable() });

export async function listar({ itemId, pagina, limite }: ConsultaInput): Promise<Pagina<ParcelaPortal & { observacao: string | null }>> {
  const db = await createClient();
  const inicio = pagina * limite;
  const { data, error } = await db.from("parcelas").select(CAMPOS_COM_OBSERVACAO)
    .eq("item_id", itemId).order("numero", { nullsFirst: false }).order("vencimento", { nullsFirst: false }).order("id").range(inicio, inicio + limite);
  conferirErro(error);
  const registros = comObservacao.array().parse(data as unknown);
  return { registros: registros.slice(0, limite), proximaPagina: registros.length > limite ? pagina + 1 : null };
}

export async function criar({ itemId, nome, vencimento, valorPrevistoCentavos, observacao }: CriarInput) {
  const db = await createClient();
  const { data, error } = await db.from("parcelas")
    .insert({ item_id: itemId, nome, vencimento, valor_previsto_centavos: valorPrevistoCentavos, observacao })
    .select(CAMPOS_COM_OBSERVACAO).single();
  conferirErro(error);
  return { registro: comObservacao.parse(data as unknown) };
}

export async function atualizar({ id, corrigir, ...campos }: AtualizarInput) {
  const db = await createClient();
  const atual = await db.from("parcelas").select("gatilho,valorPago:valor_pago_centavos::text,dataPagamento:data_pagamento").eq("id", id).maybeSingle();
  conferirErro(atual.error);
  const anterior = exigirRegistro(atual.data) as { gatilho: "data" | "evento"; valorPago: string | null; dataPagamento: string | null };
  const porEvento = anterior.gatilho === "evento";
  if (!porEvento && campos.vencimento === null) throw new BadRequestError({ vencimento: "Informe o vencimento da parcela." });
  const reduzPagamento = (anterior.valorPago !== null && BigInt(campos.valorPagoCentavos) < BigInt(anterior.valorPago))
    || (anterior.dataPagamento !== null && campos.dataPagamento === null);
  if (reduzPagamento && !corrigir) {
    throw new ConflictError("Reduzir ou desfazer um pagamento registrado exige marcar a correção explícita.");
  }
  // O valor pago lido entra no filtro: se outra pessoa registrou um pagamento
  // entre a leitura e a escrita, a regra acima foi avaliada sobre um valor velho.
  // Parcela por evento: nome, valor e vencimento só mudam ao salvar o contrato; aqui só o pagamento e a observação.
  const pagamento = {
    valor_pago_centavos: campos.valorPagoCentavos,
    data_pagamento: campos.dataPagamento,
    observacao: campos.observacao,
  };
  const alteracao = db.from("parcelas")
    .update(porEvento ? pagamento : {
      nome: campos.nome,
      vencimento: campos.vencimento,
      valor_previsto_centavos: campos.valorPrevistoCentavos,
      ...pagamento,
    })
    .eq("id", id);
  const { data, error } = await (anterior.valorPago === null
    ? alteracao.is("valor_pago_centavos", null)
    : alteracao.eq("valor_pago_centavos", anterior.valorPago)
  ).select(CAMPOS_COM_OBSERVACAO).maybeSingle();
  conferirErro(error);
  if (data === null) throw new ConflictError("A parcela foi alterada por outra pessoa. Recarregue a página e tente novamente.");
  return { registro: comObservacao.parse(data as unknown) };
}

export async function excluir(id: string) {
  const db = await createClient();
  const { data, error } = await db.from("parcelas").delete()
    .eq("id", id).eq("valor_pago_centavos", 0).is("data_pagamento", null).select("id").maybeSingle();
  conferirErro(error);
  if (data !== null) return { id };
  const existente = await db.from("parcelas").select("id").eq("id", id).maybeSingle();
  conferirErro(existente.error);
  exigirRegistro(existente.data);
  throw new ConflictError("Parcela com pagamento registrado não pode ser excluída. Corrija o pagamento antes, de forma explícita.");
}
