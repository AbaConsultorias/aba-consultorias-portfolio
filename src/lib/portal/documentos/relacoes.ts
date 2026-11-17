import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { falhaDeBanco } from "./consultas";

export type SessaoDocumentos = Awaited<ReturnType<typeof createClient>>;
export type PaisDocumento = { empreendimentoId: string; projetoId?: string | null; categoriaId?: string | null };

async function existe(sessao: SessaoDocumentos, tabela: string, filtros: Record<string, string>): Promise<boolean> {
  let consulta = sessao.from(tabela).select("id");
  for (const [campo, valor] of Object.entries(filtros)) consulta = consulta.eq(campo, valor);
  const { data, error } = await consulta.maybeSingle();
  if (error) falhaDeBanco(error);
  return data !== null;
}

// Relações conferidas com a sessão: o empreendimento existe, o projeto é dele e a categoria é do projeto.
// O empreendimento vem da lista de opções, porque quem edita documentos não precisa ler a tabela inteira.
export async function paisValidos(sessao: SessaoDocumentos, pais: PaisDocumento): Promise<boolean> {
  const empreendimentos = await listarOpcoesEmpreendimentos();
  if (!empreendimentos.some((empreendimento) => empreendimento.id === pais.empreendimentoId)) return false;
  if (!pais.projetoId) return !pais.categoriaId;
  if (!await existe(sessao, "projetos", { id: pais.projetoId, empreendimento_id: pais.empreendimentoId })) return false;
  if (!pais.categoriaId) return true;
  return existe(sessao, "projeto_categorias_documento", { id: pais.categoriaId, projeto_id: pais.projetoId });
}
