import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { atualizarSchema, consultaSchema, criarSchema, excluirSchema } from "./schema";
import { atualizar, criar, excluir, listar } from "./service";

export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "financeiro.ver");
    const consulta = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    return handleResponse({ message: "Parcelas carregadas.", details: await listar(consulta), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const data = validation({ data: await lerJsonLimitado(request, 32 * 1024), schema: criarSchema });
    const details = await criar(data);
    invalidarPortal();
    return handleResponse({ message: "Parcela criada.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PATCH(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const data = validation({ data: await lerJsonLimitado(request, 32 * 1024), schema: atualizarSchema });
    const details = await atualizar(data);
    invalidarPortal();
    return handleResponse({ message: "Alterações salvas.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const { id } = validation({ data: await lerJsonLimitado(request, 32 * 1024), schema: excluirSchema });
    const details = await excluir(id);
    invalidarPortal();
    return handleResponse({ message: "Parcela excluída.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
