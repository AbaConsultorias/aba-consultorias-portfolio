import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { consultaSchema, liberarSchema } from "./schema";
import { liberarLote, listar } from "./service";

export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "documentos.liberar");
    const consulta = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    return handleResponse({ message: "Documentos do servidor carregados.", details: await listar(consulta), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

// Liberar em lote (até 100) e liberar revisão são a mesma chamada: o serviço separa o que tem versão anterior.
export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "documentos.liberar");
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: liberarSchema });
    const details = await liberarLote(data);
    invalidarPortal();
    return handleResponse({ message: "Liberação concluída.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
