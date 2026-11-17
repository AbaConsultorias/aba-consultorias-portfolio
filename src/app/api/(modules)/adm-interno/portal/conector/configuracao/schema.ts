import z from "zod";

export const alterarSchema = z.strictObject({
  liberacaoAutomaticaGeral: z.boolean("Informe se a liberação automática fica ligada."),
});

export type AlterarInput = z.infer<typeof alterarSchema>;
