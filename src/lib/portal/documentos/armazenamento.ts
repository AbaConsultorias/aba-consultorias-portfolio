import "server-only";
import { head, lerFaixa, presignPut, remover, type EnvioAssinado, type InfoObjeto } from "@/lib/r2/cliente";

export type { EnvioAssinado, InfoObjeto };
export type Armazenamento = {
  // O R2 só aceita o PUT se tamanho e SHA-256 (hex) forem os informados aqui.
  criarUrlAssinada: (path: string, objeto: { tamanho: number; sha256: string }) => Promise<EnvioAssinado>;
  // null = objeto ausente; falha transitória lança.
  consultarObjeto: (path: string) => Promise<InfoObjeto | null>;
  // Os 5 primeiros bytes (assinatura do PDF); null = objeto ausente.
  lerCabecalho: (path: string) => Promise<Uint8Array | null>;
  // Idempotente: apagar objeto ausente não é erro.
  removerObjeto: (path: string) => Promise<void>;
};

export function sha256HexParaBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}

export const armazenamentoPadrao: Armazenamento = {
  criarUrlAssinada: (path, { tamanho, sha256 }) => presignPut(path, { tamanho, sha256Base64: sha256HexParaBase64(sha256) }),
  consultarObjeto: (path) => head(path),
  lerCabecalho: (path) => lerFaixa(path, 0, 4),
  removerObjeto: (path) => remover(path),
};
