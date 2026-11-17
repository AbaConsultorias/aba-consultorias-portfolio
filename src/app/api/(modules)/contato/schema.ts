import z from "zod";

export const contatoSchema = z.object({
  nome: z.string("Informe seu nome.").trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(120, "Use até 120 caracteres."),
  telefone: z.string("Telefone inválido.").trim().max(32, "Telefone inválido.").refine((valor) => !valor || (/^[+\d\s().-]+$/.test(valor) && /^\d{10,15}$/.test(valor.replace(/\D/g, ""))), "Informe um telefone válido com DDD.").optional(),
  email: z.string("E-mail inválido.").trim().max(254, "E-mail inválido.").refine((valor) => !valor || z.email().safeParse(valor).success, "Informe um e-mail válido.").optional(),
  mensagem: z.string("Informe sua mensagem.").trim().min(5, "Escreva uma mensagem com pelo menos 5 caracteres.").max(2000, "Use até 2000 caracteres."),
  origem: z.string("Origem inválida.").trim().min(1, "Origem inválida.").max(120, "Origem inválida.").default("contato"),
  loteamentoId: z.uuid("Interesse inválido.").optional(),
  loteId: z.uuid("Interesse inválido.").optional(),
  site: z.string("Campo inválido.").max(2000, "Campo inválido.").default(""),
}).superRefine((dados, ctx) => {
  if (!dados.telefone && !dados.email) {
    ctx.addIssue({ code: "custom", path: ["telefone"], message: "Informe seu telefone ou e-mail para receber uma resposta." });
    ctx.addIssue({ code: "custom", path: ["email"], message: "Informe seu telefone ou e-mail para receber uma resposta." });
  }
});

export type ContatoInput = z.infer<typeof contatoSchema>;
