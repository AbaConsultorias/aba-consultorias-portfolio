import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { desfazerSchema } from "../schema";
import { desfazerMudanca } from "../service";

export const dynamic = "force-dynamic";

// Desfaz a última mudança de etapa vinda dos arquivos (sugestão confirmada, automática ou recalculada).
export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 4 * 1024), schema: desfazerSchema });
    const details = await desfazerMudanca(entrada);
    invalidarPortal();
    return handleResponse({ message: "Mudança desfeita.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
