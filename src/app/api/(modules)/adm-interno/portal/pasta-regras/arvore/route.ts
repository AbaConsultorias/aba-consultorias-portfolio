import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { consultaSchema } from "../schema";
import { arvoreDoEmpreendimento } from "../service";

export const dynamic = "force-dynamic";

// Pastas que o conector informou para o código deste empreendimento (só a coluna arvore, nunca a chave).
export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "servidor.regras");
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    const details = await arvoreDoEmpreendimento(entrada);
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
