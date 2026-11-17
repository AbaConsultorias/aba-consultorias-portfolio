import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { ordenarSchema } from "../schema";
import { reordenarLoteamentos } from "../service";

export async function PUT(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const body = await lerJsonLimitado(request, 32 * 1024);
    const data = validation({ data: body, schema: ordenarSchema });

    await reordenarLoteamentos(data, user.id);

    return handleResponse({ message: "Ordem atualizada com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
