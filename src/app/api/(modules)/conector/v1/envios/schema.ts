import z from "zod";

export const envioSchema = z.strictObject({
  codigo_pasta: z.string("codigo_pasta inválido.").regex(/^[0-9]{6}$/, "codigo_pasta deve ter 6 dígitos."),
  // O site normaliza e revalida o caminho; aqui só cabe um teto para o corpo não ser usado como depósito.
  caminho_relativo: z.string("caminho_relativo inválido.").min(1, "caminho_relativo vazio.").max(4000, "caminho_relativo longo demais."),
  tamanho: z.number("tamanho inválido.").int("tamanho inválido.").min(0, "tamanho inválido.").max(Number.MAX_SAFE_INTEGER, "tamanho inválido."),
  sha256: z.string("sha256 inválido.").regex(/^[0-9a-f]{64}$/, "sha256 deve ser hex minúsculo de 64 caracteres."),
  mtime: z.iso.datetime({ offset: true, message: "mtime deve ser uma data ISO 8601." }).nullish(),
});

export type EnvioInput = z.infer<typeof envioSchema>;
