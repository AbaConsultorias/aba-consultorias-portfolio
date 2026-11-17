import z from "zod";
import { consultaPaginaSchema, statusDocumentoSchema } from "@/lib/portal/fornecedor/campos";
export const consultaSchema = consultaPaginaSchema.extend({ fornecedorId: z.uuid().optional(), status: statusDocumentoSchema.optional() });
export const atualizarSchema = z.discriminatedUnion("status", [
  z.object({ id: z.uuid(), status: z.literal("aprovado") }),
  z.object({ id: z.uuid(), status: z.literal("recusado"), motivo: z.string("Explique o motivo da recusa (pelo menos 3 caracteres).").trim().min(3, "Explique o motivo da recusa (pelo menos 3 caracteres).").max(500) }),
]);
export const excluirSchema = z.object({ id: z.uuid() });
