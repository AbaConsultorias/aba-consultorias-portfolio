import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { complementaresSchema } from "../schema";
import { definirComplementares } from "../service";

export const dynamic = "force-dynamic";

// Chave "Ler projetos complementares" do empreendimento (fica na auditoria da tabela empreendimentos).
export async function PATCH(request: Request) {
  try {
    await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 4 * 1024), schema: complementaresSchema });
    const details = await definirComplementares(entrada);
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
