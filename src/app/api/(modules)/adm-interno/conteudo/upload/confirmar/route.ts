import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { confirmarSchema } from "../schema";
import { confirmarEnvio, exigirLimiteDeConfirmacao } from "../service";

export async function POST(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");
    await exigirLimiteDeConfirmacao(user.id);

    const body = await lerJsonLimitado(request, 12 * 1024);
    const data = validation({ data: body, schema: confirmarSchema });

    return handleResponse({
      message: "Arquivo conferido.",
      details: await confirmarEnvio(data),
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
