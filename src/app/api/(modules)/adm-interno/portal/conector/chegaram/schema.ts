import z from "zod";
import { MAXIMO_LOTE } from "@/lib/portal/conector/fila";

export const consultaSchema = z.object({
  empreendimentoId: z.uuid("ID inválido.").optional(),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

export const liberarSchema = z.strictObject({
  ids: z
    .array(z.uuid("ID inválido."), "Informe os documentos.")
    .min(1, "Selecione ao menos um documento.")
    .max(MAXIMO_LOTE, `Libere no máximo ${MAXIMO_LOTE} documentos por vez.`)
    .refine((ids) => new Set(ids).size === ids.length, "Há documentos repetidos na seleção."),
});

// Ignorar usa a mesma validação de lote que liberar.
export const ignorarSchema = liberarSchema;

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type LiberarInput = z.infer<typeof liberarSchema>;
export type IgnorarInput = z.infer<typeof ignorarSchema>;
