import "server-only";
import { type BancoAdmin, falhaDeBanco } from "@/lib/conector/dependencias";
import { BLOQUEIO, LIMITE_PDF_BYTES, normalizarCaminho, VERSAO_API } from "@/lib/conector/regras";
import { createAdminClient } from "@/lib/supabase/admin";

const TAMANHO_DA_PAGINA = 1000;

type Pagina = { data: unknown[] | null; error: { code?: string } | null };
type LinhaEmpreendimento = { id: string; codigo_pasta: string };
type LinhaRegra = { id: string; empreendimento_id: string; caminho_prefixo: string };

export type Configuracao = {
  versao_api: number;
  limite_bytes: number;
  bloqueio: string[];
  empreendimentos: { codigo_pasta: string; regras: { id: string; caminho_prefixo: string }[] }[];
};

async function lerTodas<T>(operacao: string, buscar: (de: number, ate: number) => PromiseLike<Pagina>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += TAMANHO_DA_PAGINA) {
    const { data, error } = await buscar(de, de + TAMANHO_DA_PAGINA - 1);
    if (error) return falhaDeBanco(operacao, error);
    const pagina = (data ?? []) as T[];
    todas.push(...pagina);
    if (pagina.length < TAMANHO_DA_PAGINA) return todas;
  }
}

// Só empreendimentos ativos e com codigo_pasta. Sem regra ativa também entra (regras vazias): o programa não lê nenhum
// arquivo dele, só informa a árvore de pastas, que é de onde "Sugerir regras" tira as primeiras regras.
// Nada de nome, destino ou interruptor.
export async function montarConfiguracao(banco: BancoAdmin = createAdminClient()): Promise<Configuracao> {
  const empreendimentos = await lerTodas<LinhaEmpreendimento>("configuração (empreendimentos):", (de, ate) =>
    banco.from("empreendimentos").select("id,codigo_pasta").eq("situacao", "ativo").not("codigo_pasta", "is", null)
      .order("codigo_pasta").range(de, ate));
  const regras = await lerTodas<LinhaRegra>("configuração (regras):", (de, ate) =>
    banco.from("pasta_regras").select("id,empreendimento_id,caminho_prefixo").eq("ativa", true)
      .order("caminho_prefixo").order("id").range(de, ate));

  const porEmpreendimento = new Map<string, { id: string; caminho_prefixo: string }[]>();
  for (const regra of regras) {
    const lista = porEmpreendimento.get(regra.empreendimento_id) ?? [];
    lista.push({ id: regra.id, caminho_prefixo: normalizarCaminho(regra.caminho_prefixo) });
    porEmpreendimento.set(regra.empreendimento_id, lista);
  }

  return {
    versao_api: VERSAO_API,
    limite_bytes: LIMITE_PDF_BYTES,
    bloqueio: [...BLOQUEIO],
    empreendimentos: empreendimentos.map((empreendimento) => ({
      codigo_pasta: empreendimento.codigo_pasta,
      regras: porEmpreendimento.get(empreendimento.id) ?? [],
    })),
  };
}
