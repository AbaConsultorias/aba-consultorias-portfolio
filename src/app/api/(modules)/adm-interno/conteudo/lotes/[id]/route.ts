import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { atualizarLoteSchema, idSchema } from "../schema";
import { atualizarLote, excluirLote } from "../service";

type Contexto = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id } = validation({ data: await params, schema: idSchema });
    const body = await lerJsonLimitado(request, 16 * 1024);
    const data = validation({ data: body, schema: atualizarLoteSchema });

    await atualizarLote(id, data, user.id);

    return handleResponse({ message: "Lote atualizado com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id } = validation({ data: await params, schema: idSchema });

    await excluirLote(id, user.id);

    return handleResponse({ message: "Lote excluído com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
