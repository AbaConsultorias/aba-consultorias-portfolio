import { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import z from "zod";

export function conferirErro(error: unknown): void {
  if (!error) return;
  const resultado = z.object({ code: z.string().optional(), status: z.number().optional() }).safeParse(error);
  const code = resultado.success ? resultado.data.code : undefined;
  if (code === "42501") throw new ForbiddenError("Acesso negado.");
  if (code === "P0002") throw new NotFoundError("Registro indisponível.");
  if (code === "55000") throw new ConflictError("Este documento já foi revisado.");
  if (code === "54000") throw new ConflictError("Há 20 documentos aguardando revisão. Aguarde a equipe antes de enviar outro.");
  if (code === "23503") throw new ConflictError("Registro em uso. Remova os vínculos ou desative o fornecedor.");
  if (code === "23505") throw new ConflictError("Registro já cadastrado.");
  if (["23514", "22P02", "22023"].includes(code ?? "")) throw new BadRequestError("Confira os campos e os vínculos informados.");
  console.error("[fornecedor] banco:", code, resultado.success ? resultado.data.status : undefined);
  throw new InternalServerError(null);
}
