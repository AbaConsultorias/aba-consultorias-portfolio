import "server-only";
import { listarContas, criarConta, atualizarConta } from "@/lib/portal/comum/contas";
import type { CriarContaInput, AtualizarContaInput } from "@/lib/portal/comum/contas-schema";
import type { ConsultaPagina } from "@/lib/portal/comum/tipos";
export const listar = (entrada: ConsultaPagina) => listarContas("fornecedor", entrada);
export const criar = (entrada: CriarContaInput, atorId: string) => criarConta("fornecedor", entrada, atorId);
export const atualizar = (entrada: AtualizarContaInput, atorId: string) => atualizarConta("fornecedor", entrada, atorId);
