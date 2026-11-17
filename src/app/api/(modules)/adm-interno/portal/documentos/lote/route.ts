import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { loteSchema } from "./schema";
import { alterarLiberacaoEmLote } from "./service";

export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "documentos.liberar");
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: loteSchema });
    const details = await alterarLiberacaoEmLote(data);
    invalidarPortal();
    return handleResponse({ message: "Alteração em lote concluída.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
