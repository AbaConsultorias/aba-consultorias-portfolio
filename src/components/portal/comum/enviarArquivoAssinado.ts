import { MENSAGEM_FALHA_NO_SERVIDOR, buscar } from "./falhas";

export type EnvioArquivoAssinado = {
  signedUrl: string;
  arquivo: Blob;
  mime: string;
  signal?: AbortSignal;
};

export async function enviarArquivoAssinado({ signedUrl, arquivo, mime, signal }: EnvioArquivoAssinado): Promise<void> {
  const url = new URL(signedUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Endereço de envio inválido.");
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const resposta = await buscar(url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-upsert": "false",
      "cache-control": "max-age=3600",
      ...(chave ? { apikey: chave } : {}),
    },
    body: arquivo,
    signal,
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  if (resposta.ok) return;
  throw new Error(resposta.status >= 500 ? MENSAGEM_FALHA_NO_SERVIDOR : "Não foi possível enviar o arquivo. Tente novamente.");
}
