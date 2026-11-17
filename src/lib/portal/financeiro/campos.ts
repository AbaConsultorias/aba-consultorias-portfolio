import z from "zod";
import { TIPOS_EVENTO } from "./tipos";

export const centavosSchema = z.string().regex(/^\d{1,19}$/).refine((v) => /^\d{1,19}$/.test(v) && BigInt(v) <= BigInt("9223372036854775807"), "Valor fora do limite.");
export const dataCivilSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.").refine((valor) => {
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}, "Informe uma data válida.");

export const tipoEventoSchema = z.enum(TIPOS_EVENTO);

// O Postgres devolve microssegundos e o JavaScript só guarda milissegundos: o banco compara nessa precisão.
const instanteSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Instante inválido.").transform((v) => new Date(v).toISOString());

export const itemSchema = z.object({
  id: z.uuid(),
  descricao: z.string(),
  fornecedorId: z.uuid().nullable(),
  observacao: z.string().nullable(),
  valorContratadoCentavos: centavosSchema,
  codigo: z.string().nullable(),
  versao: z.number().int().nullable(),
  assinadoEm: dataCivilSchema.nullable(),
  documentoId: z.uuid().nullable(),
  atualizadoEm: instanteSchema,
});
export const parcelaSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  numero: z.number().int().nullable(),
  nome: z.string().nullable(),
  vencimento: dataCivilSchema.nullable(),
  valorPrevistoCentavos: centavosSchema,
  valorPagoCentavos: centavosSchema,
  dataPagamento: dataCivilSchema.nullable(),
  gatilho: z.enum(["data", "evento"]),
  eventoTipo: tipoEventoSchema.nullable(),
  eventoProjetoId: z.uuid().nullable(),
  eventoDescricao: z.string().nullable(),
  diasApos: z.number().int(),
  eventoId: z.uuid().nullable(),
});

// Os bigint saem como texto (cast antes do JSON) para não passar por number.
export const CAMPOS_ITEM = [
  "id", "descricao", "fornecedorId:fornecedor_id", "observacao", "valorContratadoCentavos:valor_contratado_centavos::text",
  "codigo", "versao", "assinadoEm:assinado_em", "documentoId:documento_id", "atualizadoEm:atualizado_em",
].join(",");
export const CAMPOS_PARCELA = [
  "id", "itemId:item_id", "numero", "nome", "vencimento", "dataPagamento:data_pagamento",
  "valorPrevistoCentavos:valor_previsto_centavos::text", "valorPagoCentavos:valor_pago_centavos::text",
  "gatilho", "eventoTipo:evento_tipo", "eventoProjetoId:evento_projeto_id", "eventoDescricao:evento_descricao",
  "diasApos:dias_apos", "eventoId:evento_id",
].join(",");
