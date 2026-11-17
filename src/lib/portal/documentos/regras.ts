import { compararProjetos, montarArvoreProjetos } from "../andamento/regras";
import type { UUID } from "../comum/tipos";
import type { CategoriaDocumento, DocumentoAgrupavel, GrupoDocumento, GrupoDocumentos, ProjetoDocumento, ProjetoDocumentos } from "./tipos";

export const LIMITE_PDF_BYTES = 104857600;
const ASSINATURA_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function projetoDoHash(hash: string): string | null {
  return /^#projeto-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(hash)?.[1].toLowerCase() ?? null;
}

export function comecaComPdf(bytes: Uint8Array): boolean {
  return bytes.length >= ASSINATURA_PDF.length && ASSINATURA_PDF.every((byte, i) => bytes[i] === byte);
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ["KB", "MB", "GB"];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  return `${valor.toFixed(valor >= 10 ? 0 : 1).replace(".", ",")} ${unidades[i]}`;
}

// Nome do arquivo baixado: o título sem caracteres que sistemas de arquivos recusam, sempre terminado em .pdf.
export function nomeArquivoPdf(titulo: string): string {
  const base = titulo
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+/, "")
    .replace(/\.pdf$/i, "")
    .slice(0, 120)
    .replace(/[\s.]+$/, "");
  return `${base || "documento"}.pdf`;
}

type GrupoOrdenavel<T extends DocumentoAgrupavel> = GrupoDocumentos<T> & { ordemCategoria: number };

export const NOME_DO_GRUPO: Record<GrupoDocumento, string> = { contratos: "Contratos", orcamentos: "Orçamentos", arquivo: "Outros projetos" };
// Sem projeto: Contratos, depois Orçamentos, depois Outros projetos (um grupo por rótulo, em ordem alfabética) e por último
// os documentos gerais.
const ORDEM_SEM_PROJETO = (grupo: GrupoDocumento | null) => (grupo === "contratos" ? 0 : grupo === "orcamentos" ? 1 : grupo === "arquivo" ? 2 : 3);

// Nome do cartão de um grupo sem projeto: "Contratos", "Orçamentos" ou, em Outros projetos, o rótulo da pasta.
export function nomeDoGrupoSemProjeto(grupo: GrupoDocumento, pastaRotulo: string | null): string {
  return grupo === "arquivo" && pastaRotulo ? `${NOME_DO_GRUPO.arquivo} › ${pastaRotulo}` : NOME_DO_GRUPO[grupo];
}

// Projetos na ordem definida pela equipe (depois nome e id; sem projeto por último); dentro do projeto, categorias
// na ordem cadastrada (sem categoria por último). Os documentos de cada grupo mantêm a ordem recebida.
export function agruparDocumentos<T extends DocumentoAgrupavel>(
  documentos: readonly T[],
  projetos: readonly ProjetoDocumento[],
  categorias: readonly CategoriaDocumento[],
): GrupoDocumentos<T>[] {
  const nomeProjeto = new Map(projetos.map((projeto) => [projeto.id, projeto.nome]));
  const ordemProjeto = new Map(projetos.map((projeto) => [projeto.id, projeto.ordem ?? 0]));
  const categoriaPorId = new Map(categorias.map((categoria) => [categoria.id, categoria]));
  const grupos = new Map<string, GrupoOrdenavel<T>>();

  for (const documento of documentos) {
    const projetoId = documento.projetoId;
    const projeto = projetoId ? nomeProjeto.get(projetoId) ?? "Projeto sem nome disponível" : null;
    const candidata = documento.categoriaId ? categoriaPorId.get(documento.categoriaId) : null;
    const categoria = projetoId && candidata?.projetoId === projetoId ? candidata : null;
    // grupo só vale sem projeto (CHECK documentos_grupo_sem_projeto_check).
    const grupoDoc: GrupoDocumento | null = projetoId ? null : documento.grupo ?? null;
    // O rótulo (documentos.pasta_rotulo) separa os cartões de "Outros projetos"; nos demais grupos não existe.
    const pastaRotulo = grupoDoc === "arquivo" ? documento.pastaRotulo ?? "" : null;
    const chave = `${projetoId ?? `grupo:${grupoDoc ?? ""}${pastaRotulo === null ? "" : `:${pastaRotulo}`}`}|${categoria?.id ?? ""}`;
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = {
        chave,
        projetoId,
        grupo: grupoDoc,
        pastaRotulo,
        categoriaId: categoria?.id ?? null,
        projeto,
        categoria: categoria?.nome ?? null,
        documentos: [],
        ordemCategoria: categoria?.ordem ?? Number.MAX_SAFE_INTEGER,
      };
      grupos.set(chave, grupo);
    }
    grupo.documentos.push(documento);
  }

  return [...grupos.values()]
    .sort((a, b) => Number(a.projetoId === null) - Number(b.projetoId === null)
      || (ordemProjeto.get(a.projetoId ?? "") ?? 0) - (ordemProjeto.get(b.projetoId ?? "") ?? 0)
      || (a.projeto ?? "").localeCompare(b.projeto ?? "", "pt-BR")
      || (a.projetoId ?? "").localeCompare(b.projetoId ?? "")
      || ORDEM_SEM_PROJETO(a.grupo) - ORDEM_SEM_PROJETO(b.grupo)
      || (a.pastaRotulo ?? "").localeCompare(b.pastaRotulo ?? "", "pt-BR")
      || a.ordemCategoria - b.ordemCategoria
      || (a.categoriaId ?? "").localeCompare(b.categoriaId ?? ""))
    .map(({ chave, projetoId, grupo, pastaRotulo, categoriaId, projeto, categoria, documentos: lista }) => ({ chave, projetoId, grupo, pastaRotulo, categoriaId, projeto, categoria, documentos: lista }));
}

export function agruparDocumentosPorProjeto<T extends DocumentoAgrupavel>(
  documentos: readonly T[],
  projetos: readonly ProjetoDocumento[],
  categorias: readonly CategoriaDocumento[],
): ProjetoDocumentos<T>[] {
  const resultado = new Map<string, ProjetoDocumentos<T>>();
  for (const grupo of agruparDocumentos(documentos, projetos, categorias)) {
    const chave = grupo.projetoId ?? (grupo.grupo === "arquivo" ? `arquivo:${grupo.pastaRotulo ?? ""}` : grupo.grupo ? `grupo:${grupo.grupo}` : "gerais");
    let projeto = resultado.get(chave);
    if (!projeto) {
      const nome = grupo.projeto ?? (grupo.grupo ? nomeDoGrupoSemProjeto(grupo.grupo, grupo.pastaRotulo) : "Documentos gerais");
      projeto = { chave, projetoId: grupo.projetoId, grupo: grupo.grupo, nome, quantidade: 0, categorias: [] };
      resultado.set(chave, projeto);
    }
    projeto.categorias.push(grupo);
    projeto.quantidade += grupo.documentos.length;
  }
  return [...resultado.values()];
}

export type CartaoNaArvore<T extends { projetoId: UUID | null }> = { cartao: T; nivel: number; dependeDe: string | null };

// Dependentes logo após o pai; irmãos na ordem da equipe (ordem, nome, id), sem depender da ordem de entrada;
// cartão de projeto sem metadados vai depois dos demais. O recuo só acompanha pais que também têm cartão na lista;
// o rótulo "Depende de" vale mesmo quando o pai não tem documentos nesta página. Documentos gerais ficam no fim.
export function ordenarCartoesPorArvore<T extends { projetoId: UUID | null }>(cartoes: readonly T[], projetos: readonly ProjetoDocumento[]): CartaoNaArvore<T>[] {
  const nomes = new Map(projetos.map((projeto) => [projeto.id, projeto.nome]));
  const paiPorId = new Map(projetos.map((projeto) => [projeto.id, projeto.projetoPaiId ?? null]));
  const comCartao = new Set<UUID>();
  for (const cartao of cartoes) if (cartao.projetoId !== null) comCartao.add(cartao.projetoId);
  // Sobe a cadeia até o primeiro ancestral com cartão, para o dependente não virar raiz solta quando o pai imediato não aparece.
  const paiDeRecuo = (id: UUID): UUID | null => {
    const visitados = new Set<UUID>([id]);
    let atual = paiPorId.get(id) ?? null;
    while (atual !== null && !comCartao.has(atual)) {
      if (visitados.has(atual)) return null;
      visitados.add(atual);
      atual = paiPorId.get(atual) ?? null;
    }
    return atual === id ? null : atual;
  };
  const porId = new Map(projetos.map((projeto) => [projeto.id, projeto]));
  const nos: { id: UUID; projetoPaiId: UUID | null; cartao: T }[] = [];
  for (const cartao of cartoes) {
    const projetoId: UUID | null = cartao.projetoId;
    if (projetoId !== null) nos.push({ id: projetoId, projetoPaiId: paiDeRecuo(projetoId), cartao });
  }
  nos.sort((a, b) => Number(!porId.has(a.id)) - Number(!porId.has(b.id)) || compararProjetos(porId.get(a.id) ?? a, porId.get(b.id) ?? b));
  const dependeDe = (id: UUID) => {
    const paiId = paiPorId.get(id);
    return paiId && paiId !== id ? nomes.get(paiId) ?? null : null;
  };
  return [
    ...montarArvoreProjetos(nos).map(({ projeto, nivel }) => ({ cartao: projeto.cartao, nivel, dependeDe: dependeDe(projeto.id) })),
    ...cartoes.filter((cartao) => cartao.projetoId === null).map((cartao) => ({ cartao, nivel: 0, dependeDe: null })),
  ];
}
