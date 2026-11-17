import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { modoSchema } from "../schema";
import { definirModo } from "../service";

export const dynamic = "force-dynamic";

// "Etapas pelas pastas" do empreendimento. Quem edita empreendimentos liga e desliga Sugerir; o Automático é só do
// admin (o serviço confere e o gatilho do banco também).
export async function PATCH(request: Request) {
  try {
    const { perfil } = await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 4 * 1024), schema: modoSchema });
    const details = await definirModo(entrada, perfil.papel === "admin");
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
