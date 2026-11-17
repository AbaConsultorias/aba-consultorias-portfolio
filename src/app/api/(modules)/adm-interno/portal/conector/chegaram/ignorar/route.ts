import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { ignorarSchema } from "../schema";
import { ignorarLote } from "../service";

// Ignorar (até 100): o documento sai da fila "Chegaram do servidor", mas continua oculto e guardado.
export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "documentos.liberar");
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: ignorarSchema });
    const details = await ignorarLote(data);
    invalidarPortal();
    return handleResponse({ message: "Documentos tirados da fila.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
