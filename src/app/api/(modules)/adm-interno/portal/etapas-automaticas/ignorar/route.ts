import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { ignorarSchema } from "../schema";
import { ignorarSinal } from "../service";

export const dynamic = "force-dynamic";

// Ignora o sinal (arquivo) que gerou a sugestão: ele deixa de ser sugerido, e o próximo sinal mais novo passa a valer.
export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 4 * 1024), schema: ignorarSchema });
    const details = await ignorarSinal(entrada);
    invalidarPortal();
    return handleResponse({ message: "Sugestão ignorada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
