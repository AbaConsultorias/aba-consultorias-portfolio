import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { atualizarMidiaSchema, idMidiaSchema } from "../../../schema";
import { atualizarMidia, removerMidia } from "../../../service";

type Contexto = { params: Promise<{ id: string; midiaId: string }> };

export async function PATCH(request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id, midiaId } = validation({ data: await params, schema: idMidiaSchema });
    const body = await lerJsonLimitado(request, 16 * 1024);
    const data = validation({ data: body, schema: atualizarMidiaSchema });

    await atualizarMidia(id, midiaId, data, user.id);

    return handleResponse({ message: "Mídia atualizada com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id, midiaId } = validation({ data: await params, schema: idMidiaSchema });

    await removerMidia(id, midiaId, user.id);

    return handleResponse({ message: "Mídia removida com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
