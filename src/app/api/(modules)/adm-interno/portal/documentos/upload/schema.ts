import z from "zod";
import { LIMITE_PDF_BYTES } from "@/lib/portal/documentos/regras";

export const assinarSchema = z
  .strictObject({
    empreendimentoId: z.uuid("ID inválido."),
    projetoId: z.uuid("ID inválido.").nullish(),
    categoriaId: z.uuid("ID inválido.").nullish(),
    titulo: z.string("Informe o título.").trim().min(2, "Informe o título.").max(160, "O título passa de 160 caracteres."),
    mime: z.literal("application/pdf", "Envie um arquivo PDF."),
    tamanho: z
      .number("Tamanho inválido.")
      .int("Tamanho inválido.")
      .positive("O arquivo está vazio.")
      .max(LIMITE_PDF_BYTES, "O PDF passa do limite de 100 MB."),
    sha256: z
      .string("Não foi possível conferir o arquivo.")
      .regex(/^[0-9a-f]{64}$/, "Não foi possível conferir o arquivo."),
  })
  .superRefine((valor, contexto) => {
    if (valor.categoriaId && !valor.projetoId) {
      contexto.addIssue({ code: "custom", path: ["categoriaId"], message: "Escolha o projeto da categoria." });
    }
  });

export const confirmarSchema = z.strictObject({
  comprovante: z.string("Comprovante inválido.").min(1, "Comprovante inválido.").max(4096, "Comprovante inválido."),
});

export type AssinarInput = z.infer<typeof assinarSchema>;
export type ConfirmarInput = z.infer<typeof confirmarSchema>;
