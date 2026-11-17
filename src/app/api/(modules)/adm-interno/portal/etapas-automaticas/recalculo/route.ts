import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { recalculoAplicarSchema, recalculoConsultaSchema } from "../schema";
import { aplicarSugestoes, sugestoesDoEmpreendimento } from "../service";

export const dynamic = "force-dynamic";

// Recalcular: GET lista as sugestões atuais de todos os projetos do empreendimento (só lê); POST aplica as marcadas.
export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "empreendimentos.ver");
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: recalculoConsultaSchema });
    const details = await sugestoesDoEmpreendimento(entrada);
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: recalculoAplicarSchema });
    const details = await aplicarSugestoes(entrada);
    invalidarPortal();
    return handleResponse({ message: "Etapas atualizadas.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
