import { PayloadTooLargeError } from "../HttpErrors";

const CORPO_GRANDE = "O envio é grande demais.";

// Recusa pelo Content-Length antes de ler e, sem ele (envio em partes), para de
// ler assim que passar do limite: request.json() leria o corpo inteiro. Corpo
// que não é JSON vira null, como no request.json().catch(() => null) das rotas.
export async function lerJsonLimitado(request: Request, limiteBytes: number): Promise<unknown> {
  const declarado = request.headers.get("content-length");
  if (declarado !== null && !(Number(declarado) <= limiteBytes)) {
    throw new PayloadTooLargeError(CORPO_GRANDE);
  }
  if (!request.body) return null;

  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limiteBytes) {
      await leitor.cancel().catch(() => undefined);
      throw new PayloadTooLargeError(CORPO_GRANDE);
    }
    partes.push(value);
  }

  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    bytes.set(parte, posicao);
    posicao += parte.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
