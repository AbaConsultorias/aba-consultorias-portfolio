import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { confirmarSchema } from "../schema";
import { confirmarEnvio } from "../service";

export async function POST(request: Request) {
  try {
    const { user } = await autorizarPortal("confirmar", "documentos.editar");
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: confirmarSchema });
    const details = await confirmarEnvio(data, user.id);
    invalidarPortal();
    return handleResponse({ message: "Documento enviado. Ele fica oculto até ser liberado.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
