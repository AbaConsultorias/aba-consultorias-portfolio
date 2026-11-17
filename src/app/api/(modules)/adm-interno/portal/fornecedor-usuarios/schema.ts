import z from "zod";
import { consultaPaginaSchema } from "@/lib/portal/fornecedor/campos";
export const consultaSchema = consultaPaginaSchema.extend({ fornecedorId: z.uuid() });
export const criarSchema = z.object({ fornecedorId: z.uuid(), profileId: z.uuid("Selecione uma conta.") });
export const excluirSchema = z.object({ id: z.uuid() });
