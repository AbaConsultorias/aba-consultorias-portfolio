import z from "zod";
import { MAXIMO_LOTE } from "@/lib/portal/conector/fila";

export const loteSchema = z.strictObject({
  ids: z
    .array(z.uuid("ID inválido."), "Informe os documentos.")
    .min(1, "Selecione ao menos um documento.")
    .max(MAXIMO_LOTE, `Altere no máximo ${MAXIMO_LOTE} documentos por vez.`)
    .refine((ids) => new Set(ids).size === ids.length, "Há documentos repetidos na seleção."),
  liberado: z.boolean("Valor inválido."),
});

export type LoteInput = z.infer<typeof loteSchema>;
