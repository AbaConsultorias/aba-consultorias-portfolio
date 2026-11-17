import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { confirmarSchema } from "../schema";
import { confirmarSugestao } from "../service";

export const dynamic = "force-dynamic";

// Confirma a sugestão de etapa de um projeto. O banco aplica só se o sinal ainda for a sugestão atual.
export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 4 * 1024), schema: confirmarSchema });
    const details = await confirmarSugestao(entrada);
    invalidarPortal();
    return handleResponse({ message: "Etapa atualizada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
