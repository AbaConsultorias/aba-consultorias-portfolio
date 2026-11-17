import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { atualizarCatalogoSchema } from "./schema";
import { atualizarCatalogo, listarCatalogo } from "./service";

export const dynamic = "force-dynamic";

// Catálogo de pastas do servidor: só o admin lê e edita por aqui (quem monta usa a pré-visualização de pasta-montagem).
export async function GET() {
  try {
    await autorizarPortal("leitura", "so-admin");
    const details = await listarCatalogo();
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PATCH(request: Request) {
  try {
    await autorizarPortal("escrita", "so-admin");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: atualizarCatalogoSchema });
    const details = await atualizarCatalogo(entrada);
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
