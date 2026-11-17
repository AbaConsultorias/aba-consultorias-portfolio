import { lerJsonLimitado } from "../../utils/corpo";
import { validation } from "../../utils/validation";
import { handleError } from "../../utils/handleError";
import { handleResponse } from "../../utils/handleResponse";
import { contatoSchema } from "./schema";
import { enviarContato } from "./service";

// Os campos somam poucos KB; o resto é abuso.
const LIMITE_CORPO = 16 * 1024;

export async function POST(request: Request) {
  try {
    const body = await lerJsonLimitado(request, LIMITE_CORPO);
    const dados = validation({ data: body, schema: contatoSchema });
    await enviarContato(dados, request);
    return handleResponse({ message: "Mensagem recebida. Obrigado pelo contato!", details: null, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
