import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { atualizarSchema, criarSchema } from "./schema";
import { atualizar, criar } from "./service";

const LIMITE_CORPO = 64 * 1024;

export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const data = validation({ data: await lerJsonLimitado(request, LIMITE_CORPO), schema: criarSchema });
    const details = await criar(data);
    invalidarPortal();
    return handleResponse({ message: "Contrato criado.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PATCH(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const data = validation({ data: await lerJsonLimitado(request, LIMITE_CORPO), schema: atualizarSchema });
    const details = await atualizar(data);
    invalidarPortal();
    return handleResponse({ message: "Contrato salvo.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
