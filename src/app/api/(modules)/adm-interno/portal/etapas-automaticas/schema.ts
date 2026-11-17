import z from "zod";
import { MODOS_DE_ETAPAS } from "@/lib/portal/pasta/tipos";

const uuid = z.uuid();

// O corpo só aponta para o que já existe: o banco decide se a sugestão ainda vale (a função confere o sinal atual).
export const modoSchema = z.strictObject({ empreendimentoId: uuid, modo: z.enum(MODOS_DE_ETAPAS) });
export const confirmarSchema = z.strictObject({ projetoId: uuid, sinalId: uuid });
export const ignorarSchema = z.strictObject({ sinalId: uuid });
export const desfazerSchema = z.strictObject({ historicoId: uuid });
export const recalculoConsultaSchema = z.strictObject({ empreendimentoId: uuid });
// Cada projeto vai com o sinal que a pessoa viu na lista: o banco só aplica se ainda for a sugestão daquele projeto.
export const recalculoAplicarSchema = z.strictObject({
  empreendimentoId: uuid,
  itens: z.array(z.strictObject({ projetoId: uuid, sinalId: uuid })).min(1, "Marque ao menos um projeto.").max(200)
    .refine((itens) => new Set(itens.map((item) => item.projetoId)).size === itens.length, "Projeto repetido na lista."),
});

export type ModoInput = z.infer<typeof modoSchema>;
export type ConfirmarInput = z.infer<typeof confirmarSchema>;
export type IgnorarInput = z.infer<typeof ignorarSchema>;
export type DesfazerInput = z.infer<typeof desfazerSchema>;
export type RecalculoConsultaInput = z.infer<typeof recalculoConsultaSchema>;
export type RecalculoAplicarInput = z.infer<typeof recalculoAplicarSchema>;
