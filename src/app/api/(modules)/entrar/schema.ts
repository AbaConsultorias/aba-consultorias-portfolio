import z from "zod";

const FORMATO_USUARIO = /^[a-z0-9._-]{3,64}$/i;

export const entrarSchema = z.object({
  identificador: z
    .string("Informe seu e-mail ou usuário.")
    .trim()
    .min(1, "Informe seu e-mail ou usuário.")
    .max(254, "E-mail ou usuário inválido.")
    .refine(
      (valor) =>
        valor.includes("@")
          ? z.email().safeParse(valor).success
          : FORMATO_USUARIO.test(valor),
      "E-mail ou usuário inválido.",
    ),
  senha: z
    .string("Informe sua senha.")
    .min(1, "Informe sua senha.")
    .max(128, "Senha inválida."),
});

export type EntrarInput = z.infer<typeof entrarSchema>;
