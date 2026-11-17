import { validation } from "@/app/api/utils/validation";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { handleError } from "@/app/api/utils/handleError";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { redefinirSenha } from "@/lib/portal/comum/contas-internas";
import { idSchema } from "../../schema";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

// handleResponse já envia Cache-Control: no-store, exigido numa resposta que leva senha.
export async function POST(_request: Request, { params }: Contexto) {
  try {
    const acesso = await autorizarPortal("escrita", "so-admin");
    const id = validation({ data: (await params).id, schema: idSchema });
    const details = await redefinirSenha(id, acesso.user.id);
    return handleResponse({ message: "Senha redefinida.", details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
