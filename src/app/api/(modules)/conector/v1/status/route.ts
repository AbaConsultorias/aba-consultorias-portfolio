import { semConteudo, validarCorpo } from "@/lib/conector/resposta";
import { lerCorpo, responderAoConector } from "@/lib/conector/rota";
import { statusSchema } from "./schema";
import { registrarStatus } from "./service";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// A árvore de pastas pode chegar a ~2 MB; o limite da Vercel para o corpo é 4,5 MB.
const LIMITE_DO_CORPO_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request) {
  return responderAoConector(request, async (conector) => {
    const data = validarCorpo(statusSchema, await lerCorpo(request, LIMITE_DO_CORPO_BYTES));
    await registrarStatus(data, conector);
    return semConteudo(204);
  });
}
