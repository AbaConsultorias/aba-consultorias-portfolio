import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { assinarSchema } from "../schema";
import { assinarEnvio } from "../service";

export async function POST(request: Request) {
  try {
    const { user } = await autorizarPortal("assinar", "documentos.editar");
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: assinarSchema });
    return handleResponse({ message: "Envio autorizado.", details: await assinarEnvio(data, user.id), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
