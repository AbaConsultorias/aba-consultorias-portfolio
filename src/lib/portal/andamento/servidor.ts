import "server-only";
import z from "zod";
import { BadRequestError, ConflictError, ForbiddenError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import type { ConsultaPagina } from "../comum/tipos";

export function conferirErro(error: unknown): void {
  if (!error) return;
  const erro = z.object({ code: z.string().optional(), status: z.number().optional() }).safeParse(error);
  const code = erro.success ? erro.data.code : undefined;
  if (code === "23505" || code === "23503") throw new ConflictError("Registro em uso ou já cadastrado.");
  if (["23514", "22023", "22007", "22008", "22P02"].includes(code ?? "")) throw new BadRequestError("Confira os campos e os vínculos informados.");
  if (code === "42501") throw new ForbiddenError("Acesso negado.");
  if (code === "P0002") throw new NotFoundError("Registro indisponível.");
  console.error("[andamento] banco:", code, erro.success ? erro.data.status : undefined);
  throw new InternalServerError(null);
}

export function ler<T>(schema: z.ZodType<T>, dados: unknown): T {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) throw new InternalServerError(null);
  return resultado.data;
}

export function paginacao(consulta: ConsultaPagina = {}) {
  const { pagina, limite } = z.object({ pagina: z.number().int().min(1).max(100000).default(1), limite: z.number().int().min(1).max(100).default(50) }).parse(consulta);
  return { pagina, limite, inicio: (pagina - 1) * limite };
}

export function paginaDe<T>(registros: T[], pagina: number, limite: number) {
  return { registros: registros.slice(0, limite), proximaPagina: registros.length > limite ? pagina + 1 : null };
}
