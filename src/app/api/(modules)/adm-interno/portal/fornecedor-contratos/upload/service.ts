import "server-only";
import { assinarContrato, confirmarEnvio } from "@/lib/portal/fornecedor/upload";
import type { AssinarInput } from "./schema";
export const assinar = (entrada: AssinarInput, usuarioId: string) => assinarContrato(entrada, usuarioId);
export const confirmar = (entrada: { comprovante: string }, usuarioId: string) => confirmarEnvio(entrada.comprovante, usuarioId, "fornecedor_contrato");

