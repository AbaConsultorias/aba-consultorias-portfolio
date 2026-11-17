import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";

type TabelaAgrupavel = "projetos" | "empreendimento_clientes" | "documentos";
type TabelaContavel = TabelaAgrupavel | "pasta_regras";

// O PostgREST corta a resposta em 1000 linhas: contar linha a linha pede ler em lotes, e passar do teto vira "sem número" em vez de número errado.
const TAMANHO_DO_LOTE = 1000;
const MAXIMO_DE_LOTES = 20;

const linhasSchema = z.array(z.record(z.string(), z.unknown()));

// Retorna null quando a consulta falha: a tela mostra o indicador sem o número. A permissão de ler a tabela é conferida por quem chama:
// sem ela o RLS devolveria vazio e o zero pareceria verdade.
export async function contarPorColuna({ tabela, coluna, ids, apenasOcultos = false }: {
  tabela: TabelaAgrupavel; coluna: "empreendimento_id" | "projeto_id"; ids: string[]; apenasOcultos?: boolean;
}): Promise<Map<string, number> | null> {
  const contagem = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return contagem;
  const sessao = await createClient();
  for (let lote = 0; lote < MAXIMO_DE_LOTES; lote++) {
    const inicio = lote * TAMANHO_DO_LOTE;
    let query = sessao.from(tabela).select(`id,${coluna}`).in(coluna, ids).order("id").range(inicio, inicio + TAMANHO_DO_LOTE - 1);
    if (apenasOcultos) query = query.eq("liberado_cliente", false);
    const { data, error } = await query;
    const linhas = linhasSchema.safeParse(data);
    if (error || !linhas.success) {
      console.error("[empreendimentos] contagem:", tabela, error?.code);
      return null;
    }
    for (const linha of linhas.data) {
      const chave = linha[coluna];
      if (typeof chave === "string") contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    if (linhas.data.length < TAMANHO_DO_LOTE) return contagem;
  }
  return null;
}

export async function contarLinhas(tabela: TabelaContavel, filtros: Record<string, string | boolean>): Promise<number | null> {
  const sessao = await createClient();
  let query = sessao.from(tabela).select("id", { count: "exact", head: true });
  for (const [coluna, valor] of Object.entries(filtros)) query = query.eq(coluna, valor);
  const { count, error } = await query;
  if (error || typeof count !== "number") {
    console.error("[empreendimentos] contagem:", tabela, error?.code);
    return null;
  }
  return count;
}

export async function nomesPorId(tabela: "projeto_etapas" | "modelos_etapas", ids: string[]): Promise<Map<string, string> | null> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const sessao = await createClient();
  const { data, error } = await sessao.from(tabela).select("id,nome").in("id", unicos).limit(unicos.length);
  const linhas = z.array(z.object({ id: z.string(), nome: z.string() })).safeParse(data);
  if (error || !linhas.success) {
    console.error("[empreendimentos] nomes:", tabela, error?.code);
    return null;
  }
  return new Map(linhas.data.map(({ id, nome }) => [id, nome]));
}
