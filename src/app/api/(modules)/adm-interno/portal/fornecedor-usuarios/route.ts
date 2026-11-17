import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import * as schemas from "./schema";
import * as service from "./service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "fornecedores.ver");
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: schemas.consultaSchema });
    const details = await service.listar(entrada);
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "fornecedores.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: schemas.criarSchema });
    const details = await service.criar(entrada);
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 201 });
  } catch (error) { return handleResponse(handleError(error)); }
}
export async function DELETE(request: Request) {
  try {
    await autorizarPortal("escrita", "fornecedores.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: schemas.excluirSchema });
    const details = await service.excluir(entrada);
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}

