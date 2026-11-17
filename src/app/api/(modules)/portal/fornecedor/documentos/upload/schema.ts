import z from "zod";
import { LIMITE_ARQUIVO_FORNECEDOR, MIMES_FORNECEDOR, TIPOS_DOCUMENTO } from "@/lib/portal/fornecedor/regras";
export const assinarSchema = z.object({ fornecedorId: z.uuid("Selecione um fornecedor."), empreendimentoId: z.uuid().nullish(), titulo: z.string().trim().min(2, "Informe o título.").max(160), tipo: z.enum(TIPOS_DOCUMENTO), mime: z.enum(MIMES_FORNECEDOR), tamanho: z.number().int().positive().max(LIMITE_ARQUIVO_FORNECEDOR, "O limite é 20 MiB.") });
export const confirmarSchema = z.object({ comprovante: z.string().min(1).max(8192) });
export type AssinarInput = z.infer<typeof assinarSchema>;
