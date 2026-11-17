import { compararProjetos } from "@/lib/portal/andamento/regras";
import type { SugestaoDeEtapa } from "@/lib/portal/etapas/tipos";

export type ProjetoLinha = {
  id: string;
  nome: string;
  projetoPaiId: string | null;
  ordem: number;
  // Ids de todos os irmãos (mesmo pai, inclusive os de outras páginas), na ordem da equipe; é a lista que a rota de ordem recebe.
  irmaos: string[];
  // Só preenchido quando o pai não está na página carregada (senão o recuo da árvore já diz).
  nomePaiForaDaPagina: string | null;
  modeloNome: string | null;
  etapaNome: string | null;
  temEtapaAtual: boolean;
  documentos: number | null | undefined;
  // Só com o modo "Etapas pelas pastas" ligado e um sinal novo para o projeto.
  sugestao?: SugestaoDeEtapa;
};

export type NoDaArvore = { projeto: ProjetoLinha; filhos: NoDaArvore[] };

// Irmãos (mesmo pai; null = raízes) em ordem, a partir da lista completa do empreendimento.
export function idsDosIrmaos(projetos: readonly { id: string; nome: string; projetoPaiId: string | null; ordem: number }[]): Map<string | null, string[]> {
  const grupos = new Map<string | null, string[]>();
  for (const projeto of [...projetos].sort(compararProjetos)) {
    grupos.set(projeto.projetoPaiId, [...grupos.get(projeto.projetoPaiId) ?? [], projeto.id]);
  }
  return grupos;
}

// Quem depende de um projeto que não está na lista (outra página) vira raiz. Raízes e dependentes saem na ordem
// da equipe (ordem, nome, id).
export function montarArvore(projetos: ProjetoLinha[]): NoDaArvore[] {
  const nos = new Map<string, NoDaArvore>(projetos.map((projeto) => [projeto.id, { projeto, filhos: [] }]));
  const raizes: NoDaArvore[] = [];
  for (const projeto of [...projetos].sort(compararProjetos)) {
    const no = nos.get(projeto.id);
    if (!no) continue;
    const pai = projeto.projetoPaiId ? nos.get(projeto.projetoPaiId) : undefined;
    if (pai && pai !== no) pai.filhos.push(no);
    else raizes.push(no);
  }
  return raizes;
}
