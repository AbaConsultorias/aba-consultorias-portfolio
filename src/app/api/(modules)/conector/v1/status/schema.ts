import z from "zod";
import { caminhoDePastaValido, contemCaractereInvalido, limparMensagem } from "@/lib/conector/regras";

const MAXIMO_DE_PASTAS = 5000;
const MAXIMO_DE_NIVEIS = 5;
const MAXIMO_DE_ERROS = 100;
// A coluna arvore aceita 2 MB de jsonb::text (que ocupa um pouco mais que o JSON compacto).
const MAXIMO_DA_ARVORE_BYTES = 1_900_000;
const CODIGO_DA_PASTA = /^[0-9]{6}$/;

const contagem = z.number("contagem inválida.").int("contagem inválida.").min(0, "contagem inválida.").max(1_000_000_000, "contagem inválida.").default(0);
const data = z.iso.datetime({ offset: true, message: "data deve ser ISO 8601." });

export const statusSchema = z.strictObject({
  versao: z.string("versao inválida.").trim().min(1, "versao vazia.").max(40, "versao longa demais.")
    .refine((valor) => !contemCaractereInvalido(valor), "versao inválida."),
  inicio: data,
  fim: data,
  contagens: z.strictObject({
    examinados: contagem,
    enviados: contagem,
    ja_enviados: contagem,
    duplicados: contagem,
    recusados: contagem,
    erros: contagem,
    aguardando_estabilidade: contagem,
  }),
  erros: z.array(z.strictObject({
    codigo_pasta: z.string().regex(CODIGO_DA_PASTA, "codigo_pasta deve ter 6 dígitos.").nullish(),
    mensagem: z.string("mensagem inválida.").max(500, "mensagem longa demais.").transform(limparMensagem),
  })).max(MAXIMO_DE_ERROS, "erros: no máximo 100 itens.").default([]),
  arvore: z.record(
    z.string().regex(CODIGO_DA_PASTA, "codigo_pasta deve ter 6 dígitos."),
    z.array(z.string()).max(MAXIMO_DE_PASTAS, "arvore: pastas demais."),
  ).default({}),
}).superRefine((valor, contexto) => {
  const pastas = Object.values(valor.arvore).flat();
  if (pastas.length > MAXIMO_DE_PASTAS) {
    contexto.addIssue({ code: "custom", path: ["arvore"], message: "arvore: no máximo 5000 pastas." });
    return;
  }
  if (!pastas.every((pasta) => caminhoDePastaValido(pasta, MAXIMO_DE_NIVEIS))) {
    contexto.addIssue({ code: "custom", path: ["arvore"], message: "arvore: pasta inválida ou com mais de 5 níveis." });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(valor.arvore)) > MAXIMO_DA_ARVORE_BYTES) {
    contexto.addIssue({ code: "custom", path: ["arvore"], message: "arvore: grande demais." });
  }
});

export type StatusInput = z.infer<typeof statusSchema>;
