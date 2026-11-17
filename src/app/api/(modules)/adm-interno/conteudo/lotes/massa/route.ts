import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { criarLotesEmMassaSchema } from "../schema";
import { criarLotesEmMassa } from "../service";

export async function POST(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const body = await lerJsonLimitado(request, 16 * 1024);
    const data = validation({ data: body, schema: criarLotesEmMassaSchema });

    const resultado = await criarLotesEmMassa(data, user.id);

    return handleResponse({ message: "Lotes criados com sucesso.", details: resultado, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
