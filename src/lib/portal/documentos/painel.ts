// Aba Documentos do cliente: todos os documentos liberados de uma vez, agrupados por projeto na ordem da aba
// Projetos (dependente logo após o principal), depois Contratos e Orçamentos, depois Outros projetos (um cartão por
// rótulo de pasta, em ordem alfabética) e, por último, os documentos gerais.
import { montarArvoreProjetos, ordenarProjetos } from "../andamento/regras";
import type { ProjetoPortal } from "../andamento/tipos";
import type { UUID } from "../comum/tipos";
import { NOME_DO_GRUPO } from "./regras";
import type { CategoriaDocumento, DocumentoPortal, GrupoDocumento } from "./tipos";

export type TomDaEtapa = "neutro" | "info" | "ok";
export type CategoriaDoCartao = { chave: string; nome: string | null; documentos: DocumentoPortal[] };
export type CartaoDeDocumentos = {
  chave: string;
  projetoId: UUID | null;
  nome: string;
  etapa: { nome: string; tom: TomDaEtapa } | null;
  nivel: number;
  dependeDe: string | null;
  total: number;
  categorias: CategoriaDoCartao[];
  // SIMOS e Laudos do projeto: tabela própria, fora das categorias.
  equipamentos: DocumentoPortal[];
};
export type PainelDeDocumentos = { projetos: CartaoDeDocumentos[]; contratacao: CartaoDeDocumentos[]; outros: CartaoDeDocumentos[]; gerais: CartaoDeDocumentos | null };

const ehDeEquipamento = (documento: DocumentoPortal) => Boolean(documento.equipamento && documento.equipamentoPapel);

// Primeira etapa = ainda não começou; aprovada, finalizada ou a última = concluída; o resto = em andamento.
export function tomDaEtapa(etapas: readonly { id: UUID; nome: string; ordem: number }[], etapaAtualId: UUID | null): { nome: string; tom: TomDaEtapa } | null {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const indice = ordenadas.findIndex((etapa) => etapa.id === etapaAtualId);
  if (indice < 0) return null;
  const nome = ordenadas[indice].nome;
  if (indice === 0) return { nome, tom: "neutro" };
  if (indice === ordenadas.length - 1 || /aprovad|finaliz|conclu/i.test(nome)) return { nome, tom: "ok" };
  return { nome, tom: "info" };
}

function separarPorCategoria(documentos: DocumentoPortal[], categorias: readonly CategoriaDocumento[]): CategoriaDoCartao[] {
  const porId = new Map(categorias.map((categoria) => [categoria.id, categoria]));
  const grupos = new Map<string, CategoriaDoCartao & { ordem: number }>();
  for (const documento of documentos) {
    const categoria = documento.categoriaId ? porId.get(documento.categoriaId) ?? null : null;
    const chave = categoria?.id ?? "sem-categoria";
    const grupo = grupos.get(chave) ?? { chave, nome: categoria?.nome ?? null, ordem: categoria?.ordem ?? Number.MAX_SAFE_INTEGER, documentos: [] };
    grupo.documentos.push(documento);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort((a, b) => a.ordem - b.ordem || a.chave.localeCompare(b.chave)).map(({ chave, nome, documentos: lista }) => ({ chave, nome, documentos: lista }));
}

function cartaoSemProjeto(chave: string, nome: string, documentos: DocumentoPortal[]): CartaoDeDocumentos {
  return { chave, projetoId: null, nome, etapa: null, nivel: 0, dependeDe: null, total: documentos.length, categorias: [{ chave: "sem-categoria", nome: null, documentos }], equipamentos: [] };
}

// Os documentos chegam do mais novo para o mais antigo e mantêm essa ordem dentro de cada categoria.
export function montarPainelDeDocumentos(
  documentos: readonly DocumentoPortal[],
  projetos: readonly ProjetoPortal[],
  categorias: readonly CategoriaDocumento[],
): PainelDeDocumentos {
  const conhecidos = new Set(projetos.map((projeto) => projeto.id));
  const porProjeto = new Map<UUID, DocumentoPortal[]>();
  const porGrupo = new Map<GrupoDocumento, DocumentoPortal[]>();
  const porRotulo = new Map<string, DocumentoPortal[]>();
  const gerais: DocumentoPortal[] = [];
  for (const documento of documentos) {
    if (documento.projetoId && conhecidos.has(documento.projetoId)) porProjeto.set(documento.projetoId, [...(porProjeto.get(documento.projetoId) ?? []), documento]);
    else if (!documento.projetoId && documento.grupo === "arquivo") porRotulo.set(documento.pastaRotulo ?? "", [...(porRotulo.get(documento.pastaRotulo ?? "") ?? []), documento]);
    else if (!documento.projetoId && documento.grupo) porGrupo.set(documento.grupo, [...(porGrupo.get(documento.grupo) ?? []), documento]);
    else gerais.push(documento);
  }

  const arvore = montarArvoreProjetos(ordenarProjetos(projetos));
  const paiDe = new Map(projetos.map((projeto) => [projeto.id, projeto.projetoPaiId]));
  const nomeDe = new Map(projetos.map((projeto) => [projeto.id, projeto.nome]));
  const comDocumentos = (id: UUID) => (porProjeto.get(id)?.length ?? 0) > 0;
  // Recuo = quantos ancestrais também aparecem na tela (no máximo 3).
  const nivelDe = (id: UUID) => {
    let nivel = 0;
    const vistos = new Set<UUID>([id]);
    for (let pai = paiDe.get(id) ?? null; pai && !vistos.has(pai); pai = paiDe.get(pai) ?? null) {
      vistos.add(pai);
      if (comDocumentos(pai)) nivel++;
    }
    return Math.min(nivel, 3);
  };

  const cartoesDeProjeto = arvore.filter(({ projeto }) => comDocumentos(projeto.id)).map(({ projeto }): CartaoDeDocumentos => {
    const lista = porProjeto.get(projeto.id) ?? [];
    const paiId = projeto.projetoPaiId && projeto.projetoPaiId !== projeto.id ? projeto.projetoPaiId : null;
    return {
      chave: projeto.id,
      projetoId: projeto.id,
      nome: projeto.nome,
      etapa: tomDaEtapa(projeto.etapas, projeto.etapaAtualId),
      nivel: nivelDe(projeto.id),
      dependeDe: paiId ? nomeDe.get(paiId) ?? null : null,
      total: lista.length,
      categorias: separarPorCategoria(lista.filter((documento) => !ehDeEquipamento(documento)), categorias.filter((categoria) => categoria.projetoId === projeto.id)),
      equipamentos: lista.filter(ehDeEquipamento),
    };
  });

  const contratacao = (["contratos", "orcamentos"] as const).flatMap((grupo) => {
    const lista = porGrupo.get(grupo) ?? [];
    return lista.length ? [cartaoSemProjeto(`grupo:${grupo}`, NOME_DO_GRUPO[grupo], lista)] : [];
  });

  const outros = [...porRotulo].sort(([a], [b]) => a.localeCompare(b, "pt-BR") || (a < b ? -1 : a > b ? 1 : 0))
    .map(([rotulo, lista]) => cartaoSemProjeto(`arquivo:${rotulo}`, rotulo || NOME_DO_GRUPO.arquivo, lista));

  return { projetos: cartoesDeProjeto, contratacao, outros, gerais: gerais.length ? cartaoSemProjeto("gerais", "Outros documentos", gerais) : null };
}
