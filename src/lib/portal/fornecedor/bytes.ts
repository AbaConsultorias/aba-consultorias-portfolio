import { validarBytesFoto } from "@/lib/portal/andamento/fotos";
import { comecaComPdf } from "@/lib/portal/documentos/regras";
import { LIMITE_ARQUIVO_FORNECEDOR, type MIMES_FORNECEDOR } from "./regras";

export class ArquivoFornecedorInvalido extends Error {}
export async function validarArquivoFornecedor(stream: ReadableStream<Uint8Array>, tamanho: number, mime: typeof MIMES_FORNECEDOR[number], contentType: string | null) {
  const tipo = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (tipo && tipo !== mime) {
    await stream.cancel();
    throw new ArquivoFornecedorInvalido("O formato do arquivo não corresponde ao informado.");
  }
  // O leitor de fotos da Etapa 4 limita em 10 MiB; este fluxo admite 20 MiB.
  const leitor = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > tamanho || total > LIMITE_ARQUIVO_FORNECEDOR) {
        await leitor.cancel();
        throw new ArquivoFornecedorInvalido("O arquivo excede o tamanho informado.");
      }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  if (total === 0 || total !== tamanho) throw new ArquivoFornecedorInvalido("Arquivo incompleto. Inicie um novo envio.");
  const bytes = Buffer.concat(partes, total);
  if (!(mime === "application/pdf" ? comecaComPdf(bytes) : validarBytesFoto(bytes, mime))) throw new ArquivoFornecedorInvalido("Arquivo inválido. Envie um PDF, JPEG ou PNG válido.");
}
