import z from "zod";

export const emitirSchema = z.strictObject({
  nome: z.string("Informe o nome da chave.").trim().min(1, "Informe o nome da chave.").max(80, "O nome passa de 80 caracteres.").default("Servidor da empresa"),
});

export type EmitirInput = z.infer<typeof emitirSchema>;
