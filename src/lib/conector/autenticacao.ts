import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createAdminClient } from "@/lib/supabase/admin";

const PREFIXO_DA_CHAVE = "abacon_";
const FORMATO_DA_CHAVE = /^abacon_[A-Za-z0-9_-]{43}$/;

export type ConectorAutenticado = { id: string; nome: string };
type LinhaConector = { id: string; nome: string; token_hash: string };

export function hashDaChave(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

// 32 bytes aleatórios em base64url (43 caracteres). O banco guarda só o hash.
export function gerarChave(): { chave: string; hash: string } {
  const chave = `${PREFIXO_DA_CHAVE}${randomBytes(32).toString("base64url")}`;
  return { chave, hash: hashDaChave(chave) };
}

export function extrairChave(authorization: string | null): string | null {
  const chave = /^bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
  return chave && FORMATO_DA_CHAVE.test(chave) ? chave : null;
}

// null = chave ausente, malformada, errada ou revogada (a rota responde 404 vazio). Falha do banco não é "chave
// errada": lança, para o programa tratar como erro temporário (5xx) e não como chave revogada.
export async function autenticarConector(authorization: string | null): Promise<ConectorAutenticado | null> {
  const chave = extrairChave(authorization);
  if (!chave) return null;

  const { data, error } = await createAdminClient().from("conectores").select("id,nome,token_hash").is("revogado_em", null);
  if (error) {
    console.error("[conector] falha ao consultar a chave:", error.code);
    throw new InternalServerError(null);
  }

  const recebido = Buffer.from(hashDaChave(chave), "hex");
  for (const linha of (data ?? []) as LinhaConector[]) {
    const esperado = Buffer.from(linha.token_hash, "hex");
    if (esperado.length === recebido.length && timingSafeEqual(esperado, recebido)) {
      return { id: linha.id, nome: linha.nome };
    }
  }
  return null;
}
