import z from "zod";
export const assinarSchema = z.object({ atualizacaoId: z.uuid(), mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]), tamanho: z.number().int().min(1).max(10485760), ordem: z.number().int().min(0).max(2147483647) });
export const confirmarSchema = z.object({ comprovante: z.string().min(1).max(4096) });
