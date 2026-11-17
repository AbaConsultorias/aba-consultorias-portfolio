import { handleError } from "../../../utils/handleError";
import { handleResponse } from "../../../utils/handleResponse";
import { limparOrfaos, segredoValido } from "./service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Sem schema.ts: a rota não recebe dado, só o segredo do cron no cabeçalho.
// Qualquer falha de autorização responde um 404 vazio, igual a uma rota que
// não existe, para não revelar que a tarefa está aqui.
export async function GET(request: Request) {
  if (!segredoValido(request.headers.get("authorization"))) {
    return new Response(null, { status: 404 });
  }

  try {
    const resumo = await limparOrfaos();
    return Response.json(resumo, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[limpar-orfaos] erro inesperado:", error instanceof Error ? error.name : "desconhecido");
    return handleResponse(handleError(error));
  }
}
