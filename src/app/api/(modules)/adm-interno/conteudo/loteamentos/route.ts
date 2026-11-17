import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { criarLoteamentoSchema } from "./schema";
import { criarLoteamento } from "./service";

export async function POST(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const body = await lerJsonLimitado(request, 32 * 1024);
    const data = validation({ data: body, schema: criarLoteamentoSchema });

    const resultado = await criarLoteamento(data, user.id);

    return handleResponse({ message: "Loteamento criado com sucesso.", details: resultado, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
