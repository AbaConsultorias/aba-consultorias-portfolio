import { lerJsonLimitado } from "../../utils/corpo";
import { validation } from "../../utils/validation";
import { handleError } from "../../utils/handleError";
import { handleResponse } from "../../utils/handleResponse";
import { entrarSchema } from "./schema";
import { entrar } from "./service";

export async function POST(request: Request) {
  try {
    const body = await lerJsonLimitado(request, 16 * 1024);
    const data = validation({ data: body, schema: entrarSchema });

    const { destino } = await entrar(data, request);

    return handleResponse({
      message: "Login realizado com sucesso.",
      details: { destino },
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
