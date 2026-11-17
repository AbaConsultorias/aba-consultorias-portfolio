import type { UUID } from "../comum/tipos";
import type { EtapaProjeto } from "./tipos";

export function calcularProgresso(etapas: readonly EtapaProjeto[], etapaAtualId: UUID | null): number {
  if (!etapaAtualId) return 0;
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const indice = ordenadas.findIndex((etapa) => etapa.id === etapaAtualId);
  if (indice < 0) throw new Error("Etapa atual não pertence ao projeto.");
  if (ordenadas.length === 1) return ordenadas[0].concluidaEm ? 100 : 0;
  return Math.round(100 * indice / (ordenadas.length - 1));
}

export type SituacaoEtapa = "concluida" | "atual" | "futura";

export function obterSituacaoEtapa(etapas: readonly EtapaProjeto[], etapaAtualId: UUID | null, etapaId: UUID): SituacaoEtapa {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const indice = ordenadas.findIndex((etapa) => etapa.id === etapaId);
  if (indice < 0) throw new Error("Etapa não pertence ao projeto.");
  if (ordenadas[indice].concluidaEm) return "concluida";

  const indiceAtual = ordenadas.findIndex((etapa) => etapa.id === etapaAtualId);
  if (indiceAtual < 0) return "futura";
  if (indice < indiceAtual) return "concluida";
  if (indice > indiceAtual) return "futura";
  return calcularProgresso(ordenadas, etapaAtualId) === 100 ? "concluida" : "atual";
}

export function reordenarItens<T extends { ordem: number }>(itens: readonly T[], indice: number, delta: number): T[] {
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem);
  const destino = indice + delta;
  if (indice < 0 || indice >= ordenados.length || destino < 0 || destino >= ordenados.length) return ordenados.map((item, ordem) => ({ ...item, ordem }));
  [ordenados[indice], ordenados[destino]] = [ordenados[destino], ordenados[indice]];
  return ordenados.map((item, ordem) => ({ ...item, ordem }));
}

export function podeExibirAtualizacao(publicado: boolean): boolean { return publicado === true; }

export type ProjetoOrdenavel = { id: UUID; nome?: string; ordem?: number };

// Mesma ordem das consultas (ordem, nome, id). A ordem só compara irmãos, mas ordenar a lista inteira por ela
// deixa os irmãos na ordem certa, porque filtrar uma lista ordenada mantém a ordem.
export function compararProjetos(a: ProjetoOrdenavel, b: ProjetoOrdenavel): number {
  return (a.ordem ?? 0) - (b.ordem ?? 0)
    || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR")
    || a.id.localeCompare(b.id);
}

export function ordenarProjetos<T extends ProjetoOrdenavel>(projetos: readonly T[]): T[] {
  return [...projetos].sort(compararProjetos);
}

export type NoArvoreProjetos<T> = { projeto: T; nivel: number; pai: T | null };

// Raízes e dependentes em ordem de leitura (cada dependente logo após o pai); irmãos na ordem da entrada, que
// deve vir ordenada (ordenarProjetos ou a consulta). Pai ausente vira raiz;
// ciclos (que o banco recusa) não repetem nem travam: o primeiro projeto do ciclo na entrada vira raiz.
export function montarArvoreProjetos<T extends { id: UUID; projetoPaiId: UUID | null }>(projetos: readonly T[]): NoArvoreProjetos<T>[] {
  const porId = new Map(projetos.map((projeto) => [projeto.id, projeto]));
  const filhos = new Map<UUID, T[]>();
  const raizes: T[] = [];
  for (const projeto of projetos) {
    const paiId = projeto.projetoPaiId;
    if (paiId && paiId !== projeto.id && porId.has(paiId)) filhos.set(paiId, [...(filhos.get(paiId) ?? []), projeto]);
    else raizes.push(projeto);
  }
  const resultado: NoArvoreProjetos<T>[] = [];
  const visitados = new Set<UUID>();
  function visitar(projeto: T, nivel: number, pai: T | null) {
    if (visitados.has(projeto.id)) return;
    visitados.add(projeto.id);
    resultado.push({ projeto, nivel, pai });
    for (const filho of filhos.get(projeto.id) ?? []) visitar(filho, nivel + 1, projeto);
  }
  for (const raiz of raizes) visitar(raiz, 0, null);
  for (const projeto of projetos) visitar(projeto, 0, null);
  return resultado;
}

export function textoDependentes(total: number): string {
  return `${total} ${total === 1 ? "projeto dependente" : "projetos dependentes"}`;
}

export type GrupoProjetos<T> = { projeto: T; pai: T | null; nivel: number; dependentes: GrupoProjetos<T>[]; totalDependentes: number };

// A mesma árvore de montarArvoreProjetos, aninhada: quem tem dependentes vira um grupo recolhível.
// totalDependentes conta todos os descendentes (o que fica escondido quando o grupo está recolhido).
export function montarGruposProjetos<T extends { id: UUID; projetoPaiId: UUID | null }>(projetos: readonly T[]): GrupoProjetos<T>[] {
  const raizes: GrupoProjetos<T>[] = [];
  const caminho: GrupoProjetos<T>[] = [];
  for (const { projeto, nivel, pai } of montarArvoreProjetos(projetos)) {
    const grupo: GrupoProjetos<T> = { projeto, pai, nivel, dependentes: [], totalDependentes: 0 };
    caminho.length = nivel;
    const paiDireto = caminho.at(-1);
    if (paiDireto) paiDireto.dependentes.push(grupo);
    else raizes.push(grupo);
    for (const ancestral of caminho) ancestral.totalDependentes += 1;
    caminho.push(grupo);
  }
  return raizes;
}
