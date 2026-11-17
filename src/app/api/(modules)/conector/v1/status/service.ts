import "server-only";
import type { ConectorAutenticado } from "@/lib/conector/autenticacao";
import { type BancoAdmin, falhaDeBanco } from "@/lib/conector/dependencias";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StatusInput } from "./schema";

// Guarda o resumo do último ciclo e a árvore de pastas (que o admin usa para montar as regras).
export async function registrarStatus(
  entrada: StatusInput,
  conector: ConectorAutenticado,
  agora: () => number = Date.now,
  banco: BancoAdmin = createAdminClient(),
): Promise<void> {
  const { error } = await banco.from("conectores").update({
    ultimo_contato_em: new Date(agora()).toISOString(),
    versao: entrada.versao,
    ultimo_ciclo: { inicio: entrada.inicio, fim: entrada.fim, contagens: entrada.contagens, erros: entrada.erros },
    arvore: entrada.arvore,
  }).eq("id", conector.id).is("revogado_em", null);
  if (error) falhaDeBanco("status: gravação do ciclo:", error);
}
