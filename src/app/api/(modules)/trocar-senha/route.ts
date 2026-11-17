import { lerJsonLimitado } from "../../utils/corpo";
import { validation } from "../../utils/validation";
import { handleError } from "../../utils/handleError";
import { handleResponse } from "../../utils/handleResponse";
import { exigirPapelApi } from "@/lib/auth/guard";
import { PAPEIS_STAFF, PAPEIS_USUARIO } from "@/lib/auth/papeis";
import { trocarSenhaSchema } from "./schema";
import { trocarSenha } from "./service";

export async function POST(request: Request) {
  try {
    const acesso = await exigirPapelApi([...PAPEIS_USUARIO, ...PAPEIS_STAFF], {
      permitirTrocaSenhaPendente: true,
    });

    const body = await lerJsonLimitado(request, 16 * 1024);
    const data = validation({ data: body, schema: trocarSenhaSchema });

    const { destino } = await trocarSenha(data, acesso);

    return handleResponse({
      message: "Senha alterada com sucesso.",
      details: { destino },
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
