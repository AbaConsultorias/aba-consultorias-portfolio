import z from "zod";

const titulo = z.string("Informe o título.").trim().min(2, "Informe o título.").max(160, "O título passa de 160 caracteres.");

export const consultaSchema = z.object({
  empreendimentoId: z.uuid("ID inválido.").optional(),
  projetoId: z.uuid("ID inválido.").optional(),
  liberado: z.enum(["true", "false"]).transform((valor) => valor === "true").optional(),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

export const atualizarSchema = z
  .strictObject({
    id: z.uuid("ID inválido."),
    titulo: titulo.optional(),
    projetoId: z.uuid("ID inválido.").nullable().optional(),
    categoriaId: z.uuid("ID inválido.").nullable().optional(),
    liberado: z.boolean("Valor inválido.").optional(),
  })
  .refine((valor) => Object.keys(valor).some((campo) => campo !== "id"), "Informe o que alterar.");

export const excluirSchema = z.strictObject({ id: z.uuid("ID inválido.") });

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
