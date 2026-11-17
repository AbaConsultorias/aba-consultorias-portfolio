import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { consultaSchema } from "./schema";
import { listar } from "./service";

export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "so-admin");
    const consulta = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    return handleResponse({ message: "Downloads carregados.", details: await listar(consulta), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
