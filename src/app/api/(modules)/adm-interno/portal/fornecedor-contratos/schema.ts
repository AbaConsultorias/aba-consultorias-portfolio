import z from "zod";
import { consultaPaginaSchema } from "@/lib/portal/fornecedor/campos";
export const consultaSchema = consultaPaginaSchema.extend({ fornecedorId: z.uuid() });
export const atualizarSchema = z.object({ id: z.uuid(), titulo: z.string().trim().min(2, "Informe o título.").max(160), empreendimentoId: z.uuid().nullable() });
export const excluirSchema = z.object({ id: z.uuid() });
