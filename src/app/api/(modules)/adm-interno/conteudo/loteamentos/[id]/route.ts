import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { atualizarLoteamentoSchema, idSchema } from "../schema";
import { atualizarLoteamento, excluirLoteamento } from "../service";

type Contexto = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id } = validation({ data: await params, schema: idSchema });
    const body = await lerJsonLimitado(request, 32 * 1024);
    const data = validation({ data: body, schema: atualizarLoteamentoSchema });

    await atualizarLoteamento(id, data, user.id);

    return handleResponse({ message: "Loteamento atualizado com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id } = validation({ data: await params, schema: idSchema });

    await excluirLoteamento(id, user.id);

    return handleResponse({ message: "Loteamento excluído com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
