import "server-only";
import { assinarDocumento, confirmarEnvio } from "@/lib/portal/fornecedor/upload";
import type { AssinarInput } from "./schema";
export const assinar = (entrada: AssinarInput, usuarioId: string) => assinarDocumento(entrada, usuarioId);
export const confirmar = (entrada: { comprovante: string }, usuarioId: string) => confirmarEnvio(entrada.comprovante, usuarioId, "fornecedor_documento");

