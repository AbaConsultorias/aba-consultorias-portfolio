import "server-only";
import z from "zod";
import { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";

export function conferirErro(error: unknown): void {
  if (!error) return;
  const resultado = z.object({ code: z.string().optional(), status: z.number().optional() }).safeParse(error);
  const code = resultado.success ? resultado.data.code : undefined;
  if (code === "42501") throw new ForbiddenError("Você não tem acesso a esta obra.");
  if (code === "P0002") throw new NotFoundError("Registro não encontrado.");
  if (code === "55000") throw new ConflictError("Este relato já foi revisado. Atualize a página.");
  if (code === "54000") throw new ConflictError("Você já tem cinco relatos pendentes nesta obra. Aguarde a revisão da ABA.");
  if (code === "23505") throw new ConflictError("Registro já cadastrado.");
  if (code === "23503") throw new ConflictError("Este registro está em uso. Confira os vínculos.");
  if (["23514", "22P02", "22003", "22007", "22008"].includes(code ?? "")) throw new BadRequestError("Confira os dados e os vínculos informados.");
  console.error("[obras] banco:", code, resultado.success ? resultado.data.status : undefined);
  throw new InternalServerError("Não foi possível concluir. Tente novamente.");
}
