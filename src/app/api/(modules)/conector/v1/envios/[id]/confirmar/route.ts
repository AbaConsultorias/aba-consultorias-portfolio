import { json, validarCorpo } from "@/lib/conector/resposta";
import { lerCorpo, responderAoConector } from "@/lib/conector/rota";
import { confirmarSchema, envioIdSchema } from "./schema";
import { confirmarEnvio } from "./service";

// O HEAD e a leitura de 5 bytes no R2 têm 15 s de limite cada.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return responderAoConector(request, async (conector) => {
    const envioId = validarCorpo(envioIdSchema, (await params).id);
    // Sem corpo (ou corpo que não é JSON) vale como "{}".
    validarCorpo(confirmarSchema, (await lerCorpo(request, 1024)) ?? {});
    return json(await confirmarEnvio(envioId, conector));
  });
}
