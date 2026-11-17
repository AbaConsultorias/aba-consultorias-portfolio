import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { atualizarSchema, consultaSchema, excluirSchema } from "./schema";
import { atualizar, excluir, exigirPermissoesDaAlteracao, listar } from "./service";

export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "documentos.ver");
    const consulta = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    return handleResponse({ message: "Documentos carregados.", details: await listar(consulta), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const { permissoes } = await autorizarPortal("escrita", { qualquer: ["documentos.editar", "documentos.liberar"] });
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: atualizarSchema });
    exigirPermissoesDaAlteracao(data, permissoes);
    const details = await atualizar(data);
    invalidarPortal();
    return handleResponse({ message: "Alterações salvas.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(request: Request) {
  try {
    const { permissoes } = await autorizarPortal("escrita", "documentos.editar");
    const { id } = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: excluirSchema });
    const details = await excluir(id, permissoes);
    invalidarPortal();
    return handleResponse({ message: "Documento excluído.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
