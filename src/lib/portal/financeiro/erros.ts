import "server-only";
import { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";

// As mensagens do P0001 e do 22023 vêm das funções do financeiro e já são em português, escritas para a tela.
const MENSAGEM_DE_CONFLITO = /alterado por outra pessoa|^Já marcado/;

export function conferirErro(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42501") throw new ForbiddenError("Acesso negado.");
  if (error.code === "P0001" || error.code === "22023") {
    const mensagem = error.message?.trim().slice(0, 300) || "Confira os dados informados.";
    throw MENSAGEM_DE_CONFLITO.test(mensagem) ? new ConflictError(mensagem) : new BadRequestError(mensagem);
  }
  if (error.code === "23503" || error.code === "23514" || error.code === "22P02" || error.code === "22003") {
    throw new BadRequestError("Confira os dados informados.");
  }
  if (error.code === "23505") throw new ConflictError("Registro duplicado.");
  console.error("[portal] financeiro:", error.code);
  throw new InternalServerError("Não foi possível concluir a operação.");
}

export function exigirRegistro<T>(registro: T | null): T {
  if (registro === null) throw new NotFoundError("Registro não encontrado.");
  return registro;
}
