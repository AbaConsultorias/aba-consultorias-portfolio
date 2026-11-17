import { lerJsonLimitado } from "../../../utils/corpo";
import { validation } from "../../../utils/validation";
import { handleError } from "../../../utils/handleError";
import { handleResponse } from "../../../utils/handleResponse";
import { entrarAdminSchema } from "./schema";
import { entrarAdmin } from "./service";

// Só é alcançável por /<ADMIN_PATH>/api/entrar (o proxy reescreve); o acesso
// direto a /api/adm-interno/entrar responde 404 no proxy.
export async function POST(request: Request) {
  try {
    const body = await lerJsonLimitado(request, 16 * 1024);
    const data = validation({ data: body, schema: entrarAdminSchema });

    const { destino } = await entrarAdmin(data, request);

    return handleResponse({
      message: "Login realizado com sucesso.",
      details: { destino },
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
