import z from "zod";

export const consultaSchema = z.object({
  documentoId: z.uuid("ID inválido."),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

export type ConsultaInput = z.infer<typeof consultaSchema>;
