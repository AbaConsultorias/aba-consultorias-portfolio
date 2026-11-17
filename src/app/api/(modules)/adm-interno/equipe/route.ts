import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { listar, criar, atualizar } from "@/lib/portal/comum/contas-internas";
import { criarSchema, atualizarSchema } from "./schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await autorizarPortal("leitura", "so-admin");
    const registros = await listar();
    return handleResponse({ message: "Consulta realizada.", details: { registros }, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}

export async function POST(request: Request) {
  try {
    const acesso = await autorizarPortal("criar_conta", "so-admin");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: criarSchema });
    const details = await criar(entrada, acesso.user.id);
    return handleResponse({ message: "Conta criada.", details, status: 201 });
  } catch (error) { return handleResponse(handleError(error)); }
}

export async function PATCH(request: Request) {
  try {
    const acesso = await autorizarPortal("escrita", "so-admin");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: atualizarSchema });
    const details = await atualizar(entrada, acesso.user.id);
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
