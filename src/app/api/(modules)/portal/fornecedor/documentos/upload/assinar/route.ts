import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { assinarSchema } from "../schema";
import { assinar } from "../service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const acesso = await autorizarPortal("assinar", { externos: ["fornecedor"] });
    const entrada = validation({ data: await lerJsonLimitado(request, 12 * 1024), schema: assinarSchema });
    const details = await assinar(entrada, acesso.user.id);
    
    return handleResponse({ message: "Envio autorizado.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}

