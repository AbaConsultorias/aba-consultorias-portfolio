import { json, validarCorpo } from "@/lib/conector/resposta";
import { lerCorpo, responderAoConector } from "@/lib/conector/rota";
import { envioSchema } from "./schema";
import { pedirAutorizacao } from "./service";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return responderAoConector(request, async (conector) => {
    const data = validarCorpo(envioSchema, await lerCorpo(request, 16 * 1024));
    return json(await pedirAutorizacao(data, conector));
  });
}
