import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { consultaSchema, criarSchema, atualizarSchema, excluirSchema } from "./schema";
import { listar, criar, atualizar, excluir } from "./service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "obras.ver");
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    const details = await listar(entrada);
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}

export async function POST(request: Request) {
  try {
    const acesso = await autorizarPortal("escrita", "obras.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: criarSchema });
    const details = await criar(entrada, acesso.permissoes.has("obras.aprovar"));
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 201 });
  } catch (error) { return handleResponse(handleError(error)); }
}

export async function PATCH(request: Request) {
  try {
    const acesso = await autorizarPortal("escrita", "obras.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: atualizarSchema });
    const details = await atualizar(entrada, acesso.permissoes.has("obras.aprovar"));
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}

export async function DELETE(request: Request) {
  try {
    await autorizarPortal("escrita", "obras.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: excluirSchema });
    const details = await excluir(entrada);
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
