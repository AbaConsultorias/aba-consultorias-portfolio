import z from "zod";

export const trocarSenhaSchema = z
  .object({
    senhaAtual: z
      .string("Informe sua senha atual.")
      .min(1, "Informe sua senha atual.")
      .max(128, "Senha inválida."),
    novaSenha: z
      .string("Informe a nova senha.")
      .min(10, "A nova senha precisa ter pelo menos 10 caracteres.")
      .max(72, "A nova senha pode ter no máximo 72 caracteres.")
      .regex(/\p{L}/u, "A nova senha precisa ter pelo menos uma letra.")
      .regex(/\d/, "A nova senha precisa ter pelo menos um número."),
    confirmacao: z.string("Confirme a nova senha."),
  })
  .refine((dados) => dados.novaSenha === dados.confirmacao, {
    message: "A confirmação não é igual à nova senha.",
    path: ["confirmacao"],
  })
  .refine((dados) => dados.novaSenha !== dados.senhaAtual, {
    message: "A nova senha precisa ser diferente da atual.",
    path: ["novaSenha"],
  });

export type TrocarSenhaInput = z.infer<typeof trocarSenhaSchema>;
