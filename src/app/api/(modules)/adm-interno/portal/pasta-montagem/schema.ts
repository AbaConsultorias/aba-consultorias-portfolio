import z from "zod";
import { SISTEMAS } from "@/lib/conector/montagem";

const chaveDoItem = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

export const consultaSchema = z.strictObject({ empreendimentoId: z.uuid() });

// O corpo só escolhe entre candidatas: o servidor recalcula a pré-visualização e descarta qualquer caminho que não esteja nela.
export const montarSchema = z.strictObject({
  empreendimentoId: z.uuid(),
  itens: z.array(z.strictObject({
    chave: chaveDoItem,
    sistema: z.enum(SISTEMAS).nullable().optional(),
    caminhos: z.array(z.string().min(1).max(1000)).max(10),
  })).min(1, "Marque ao menos um item.").max(50),
});

export const complementaresSchema = z.strictObject({
  empreendimentoId: z.uuid(),
  lerComplementares: z.boolean(),
});

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type MontarInput = z.infer<typeof montarSchema>;
export type ComplementaresInput = z.infer<typeof complementaresSchema>;
