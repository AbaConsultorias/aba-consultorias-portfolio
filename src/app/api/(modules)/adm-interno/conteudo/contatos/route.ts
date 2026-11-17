import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { consultaSchema, atualizarSchema } from "./schema";
import { listar, atualizar } from "./service";
export async function GET(request: Request) {
    try {
        await autorizarConteudo("contatos.ver");
        const consulta = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
        return handleResponse({
            message: "Conteúdo carregado.", details: await listar(consulta), status: 200
        });
    }
    catch (error) {
        return handleResponse(handleError(error));
    }
}
export async function PATCH(request: Request) {
    try {
        await autorizarConteudo("contatos.editar");
        const data = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: atualizarSchema });
        return handleResponse({
            message: "Alterações salvas.", details: await atualizar(data), status: 200
        });
    }
    catch (error) {
        return handleResponse(handleError(error));
    }
}
