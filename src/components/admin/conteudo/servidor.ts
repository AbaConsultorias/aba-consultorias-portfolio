import "server-only";
import { exigirRegraApi } from "@/lib/auth/permissoes-servidor";
import type { RegraInterna } from "@/lib/auth/regras";
import { limitar } from "@/lib/rate-limit";
import { ConflictError, InternalServerError, TooManyRequestsError, BadRequestError } from "@/app/api/HttpErrors";
export async function autorizarConteudo(regra: RegraInterna) {
    const acesso = await exigirRegraApi(regra);
    if (!await limitar(`conteudo:${acesso.user.id}`, 120, 60))
        throw new TooManyRequestsError("Aguarde um minuto e tente novamente.");
    return acesso;
}
export function conferirErro(error: {
    code?: string;
} | null) {
    if (!error)
        return;
    if (error.code === "23505")
        throw new ConflictError("Já existe um registro com este slug.");
    if (error.code === "23503" || error.code === "23514" || error.code === "22P02")
        throw new BadRequestError("Confira os dados informados.");
    throw new InternalServerError("Não foi possível concluir a operação.");
}
export function exigirRegistro<T>(data: T | null): T {
    if (!data)
        throw new BadRequestError("Registro indisponível.");
    return data;
}
