import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { salvarPermissoes } from "@/lib/portal/comum/contas-internas";
import { idSchema, permissoesSchema } from "../../schema";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Contexto) {
  try {
    await autorizarPortal("escrita", "so-admin");
    const id = validation({ data: (await params).id, schema: idSchema });
    const entrada = validation({ data: await lerJsonLimitado(request, 4 * 1024), schema: permissoesSchema });
    const details = await salvarPermissoes(id, entrada.permissoes);
    return handleResponse({ message: "Permissões salvas.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
