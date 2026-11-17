import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { adicionarMidiaSchema, idSchema, ordenarSchema } from "../../schema";
import { adicionarMidia, reordenarMidias } from "../../service";

type Contexto = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id } = validation({ data: await params, schema: idSchema });
    const body = await lerJsonLimitado(request, 32 * 1024);
    const data = validation({ data: body, schema: adicionarMidiaSchema });

    const resultado = await adicionarMidia(id, data, user.id);

    return handleResponse({ message: "Mídia adicionada com sucesso.", details: resultado, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PUT(request: Request, { params }: Contexto) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const { id } = validation({ data: await params, schema: idSchema });
    const body = await lerJsonLimitado(request, 32 * 1024);
    const data = validation({ data: body, schema: ordenarSchema });

    await reordenarMidias(id, data, user.id);

    return handleResponse({ message: "Ordem da galeria atualizada com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
