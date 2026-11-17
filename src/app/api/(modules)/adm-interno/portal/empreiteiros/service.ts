import "server-only";
import { listarContas, criarConta, atualizarConta } from "@/lib/portal/comum/contas";
import type { CriarContaInput, AtualizarContaInput } from "@/lib/portal/comum/contas-schema";
import type { ConsultaPagina, UUID } from "@/lib/portal/comum/tipos";

export const listar = (consulta?: ConsultaPagina) => listarContas("empreiteiro", consulta);
export const criar = (entrada: CriarContaInput, atorId: UUID) => criarConta("empreiteiro", entrada, atorId);
export const atualizar = (entrada: AtualizarContaInput, atorId: UUID) => atualizarConta("empreiteiro", entrada, atorId);
