import { json } from "@/lib/conector/resposta";
import { responderAoConector } from "@/lib/conector/rota";
import { montarConfiguracao } from "./service";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Sem schema.ts: a rota não recebe dado. Chave inválida responde 404 vazio (ver responderAoConector).
export async function GET(request: Request) {
  return responderAoConector(request, async () => json(await montarConfiguracao()));
}
