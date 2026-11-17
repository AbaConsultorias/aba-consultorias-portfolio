import z from "zod";
import { chamarApi } from "@/components/admin/comum/cliente-api";
// chamarApi não expõe o status; 401 e 403 chegam com estas mensagens do guard e do proxy.
const MENSAGENS_DE_SESSAO = new Set(["Sessão inválida.", "Acesso negado."]);
export class ErroSessaoExpirada extends Error {
    constructor() {
        super("Sua sessão expirou. Entre de novo.");
    }
}
export async function requisitar(adminPath: string, recurso: string, method: string, body?: unknown) {
    // chamarApi só tipa métodos com corpo, mas o fetch por baixo aceita GET (usado na galeria).
    const resposta = await chamarApi(adminPath, recurso, method as Parameters<typeof chamarApi>[2], body);
    if (!resposta.ok) {
        if (resposta.erro && MENSAGENS_DE_SESSAO.has(resposta.erro))
            throw new ErroSessaoExpirada();
        throw new Error(Object.values(resposta.erros)[0] ?? resposta.erro ?? "Não foi possível concluir. Tente novamente.");
    }
    const formato = z.record(z.string(), z.unknown()).safeParse(resposta.details);
    if (!formato.success)
        throw new Error("Resposta inesperada. Atualize a página.");
    return formato.data;
}
export async function removerArquivos(adminPath: string, arquivos: string[]) {
    for (const path of [...new Set(arquivos)])
        await requisitar(adminPath, "upload", "DELETE", { path });
}
