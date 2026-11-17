import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { enviarSchema } from "./schema";
import { enviar } from "./service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const acesso = await autorizarPortal("enviar_relato", { externos: ["empreiteiro"] });
    const entrada = validation({ data: await lerJsonLimitado(request, 64 * 1024), schema: enviarSchema });
    const details = await enviar(entrada, acesso.user.id);
    invalidarPortal();
    return handleResponse({ message: "Relato enviado para revisão.", details, status: 201 });
  } catch (error) { return handleResponse(handleError(error)); }
}
