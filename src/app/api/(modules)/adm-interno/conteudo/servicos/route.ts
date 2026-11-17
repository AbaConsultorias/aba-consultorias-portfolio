import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { consultaSchema, atualizarSchema, criarSchema, excluirSchema } from "./schema";
import { listar, atualizar, criar, excluir } from "./service";
export async function GET(request: Request) {
    try {
        await autorizarConteudo("site.ver");
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
        await autorizarConteudo("site.editar");
        const data = validation({ data: await lerJsonLimitado(request, 64 * 1024), schema: atualizarSchema });
        return handleResponse({
            message: "Alterações salvas.", details: await atualizar(data), status: 200
        });
    }
    catch (error) {
        return handleResponse(handleError(error));
    }
}
export async function POST(request: Request) {
    try {
        await autorizarConteudo("site.editar");
        const data = validation({ data: await lerJsonLimitado(request, 64 * 1024), schema: criarSchema });
        return handleResponse({
            message: "Registro criado.", details: await criar(data), status: 201
        });
    }
    catch (error) {
        return handleResponse(handleError(error));
    }
}
export async function DELETE(request: Request) {
    try {
        await autorizarConteudo("site.editar");
        const { id } = validation({ data: await lerJsonLimitado(request, 64 * 1024), schema: excluirSchema });
        return handleResponse({
            message: "Registro excluído.", details: await excluir(id), status: 200
        });
    }
    catch (error) {
        return handleResponse(handleError(error));
    }
}
