import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { assinarSchema } from "../schema";
import { assinarEnvio, exigirLimiteDeEnvio } from "../service";

// Devolve uma URL assinada (sem upsert) para o navegador enviar a imagem ou o
// vídeo direto ao storage; depois o cliente chama upload/confirmar.
export async function POST(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");
    await exigirLimiteDeEnvio(user.id);

    const body = await lerJsonLimitado(request, 12 * 1024);
    const data = validation({ data: body, schema: assinarSchema });

    return handleResponse({
      message: "Envio autorizado.",
      details: await assinarEnvio(data),
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
