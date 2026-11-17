import z from "zod";

export const entrarAdminSchema = z.object({
  email: z
    .string("Informe seu e-mail.")
    .trim()
    .max(254, "E-mail inválido.")
    .pipe(z.email("E-mail inválido.")),
  senha: z
    .string("Informe sua senha.")
    .min(1, "Informe sua senha.")
    .max(128, "Senha inválida."),
});

export type EntrarAdminInput = z.infer<typeof entrarAdminSchema>;
