import { handleError } from "../../utils/handleError";
import { handleResponse } from "../../utils/handleResponse";
import { sair } from "./service";

// Sem schema.ts: essa rota não recebe nenhum dado pra validar.
export async function POST() {
  try {
    await sair();
    return handleResponse({
      message: "Logout realizado com sucesso.",
      details: null,
      status: 200,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
