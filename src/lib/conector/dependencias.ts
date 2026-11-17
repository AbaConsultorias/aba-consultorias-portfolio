import "server-only";
import { randomUUID } from "node:crypto";
import { InternalServerError } from "@/app/api/HttpErrors";
import { armazenamentoPadrao, type Armazenamento } from "@/lib/portal/documentos/armazenamento";
import { createAdminClient } from "@/lib/supabase/admin";
import { chaveDoCaminho } from "./regras";

export type DependenciasConector = {
  armazenamento: Armazenamento;
  novoId: () => string;
  agora: () => number;
};

export const dependenciasPadrao: DependenciasConector = {
  armazenamento: armazenamentoPadrao,
  novoId: randomUUID,
  agora: Date.now,
};

export type BancoAdmin = ReturnType<typeof createAdminClient>;

export function falhaDeBanco(operacao: string, error: { code?: string }): never {
  console.error("[conector]", operacao, error.code);
  throw new InternalServerError(null);
}

// LIKE sem curinga: %, _ e a própria barra invertida valem como texto.
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

export type EnvioConfirmado = { id: string; sha256: string; documento_id: string | null; caminho_relativo: string };

// Último envio confirmado do caminho (sem diferenciar caixa) no empreendimento. O ilike só reduz as candidatas
// (a coluna é indexada por lower()); a igualdade de verdade é conferida aqui, com a mesma regra do casamento de regras.
export async function buscarUltimoConfirmado(
  banco: BancoAdmin,
  empreendimentoId: string,
  caminho: string,
  excetoEnvioId?: string,
): Promise<EnvioConfirmado | null> {
  const { data, error } = await banco.from("conector_envios")
    .select("id,sha256,documento_id,caminho_relativo")
    .eq("empreendimento_id", empreendimentoId)
    .eq("estado", "confirmado")
    .ilike("caminho_relativo", escaparLike(caminho))
    .order("em", { ascending: false })
    .limit(50);
  if (error) return falhaDeBanco("consulta do último envio confirmado:", error);

  const chave = chaveDoCaminho(caminho);
  const candidatos = (data ?? []) as EnvioConfirmado[];
  return candidatos.find((linha) => linha.id !== excetoEnvioId && chaveDoCaminho(linha.caminho_relativo) === chave) ?? null;
}

export async function existeConfirmadoComSha(
  banco: BancoAdmin,
  empreendimentoId: string,
  sha256: string,
  excetoEnvioId?: string,
): Promise<boolean> {
  const { data, error } = await banco.from("conector_envios").select("id")
    .eq("empreendimento_id", empreendimentoId).eq("estado", "confirmado").eq("sha256", sha256).limit(2);
  if (error) return falhaDeBanco("consulta de duplicado:", error);
  return ((data ?? []) as { id: string }[]).some((linha) => linha.id !== excetoEnvioId);
}
