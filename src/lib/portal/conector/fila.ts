export const MAXIMO_LOTE = 100;

const ROTULO_GRUPO: Record<string, string> = { contratos: "Contratos", orcamentos: "Orçamentos", arquivo: "Outros projetos" };

export type LinhaFila = {
  id: string;
  empreendimentoId: string;
  projetoId: string | null;
  categoriaId: string | null;
  grupo: string | null;
  // Nome do cartão em "Outros projetos"; só existe com grupo "arquivo".
  pastaRotulo?: string | null;
  titulo: string;
  tamanho: number;
  criadoEm: string;
  substituiId: string | null;
  familiaId: string;
  equipamento?: string | null;
  equipamentoPapel?: "simo" | "laudo" | null;
  // Caminho no servidor da empresa: só a equipe vê (documento_origens não é legível pelo cliente).
  caminhoRelativo: string;
};

export type VersaoVisivel = { id: string; titulo: string; liberadoEm: string | null };

export type ContextoFila = {
  empreendimentos: ReadonlyMap<string, string>;
  projetos: ReadonlyMap<string, string>;
  categorias: ReadonlyMap<string, string>;
  // Documentos que já têm uma versão mais nova na família: ficam fora da fila.
  comVersaoMaisNova: ReadonlySet<string>;
  // Versão que o cliente vê hoje, por família.
  visiveisPorFamilia: ReadonlyMap<string, VersaoVisivel>;
};

export type ItemFila = {
  id: string;
  titulo: string;
  empreendimentoId: string;
  empreendimentoNome: string | null;
  destino: string;
  // "SIMO · BOMBAS" ou "Laudo · BOMBAS"; nulo nos documentos de regra comum.
  equipamento: string | null;
  tamanho: number;
  criadoEm: string;
  origem: string;
  revisao: { visivel: VersaoVisivel | null } | null;
  downloadHref: string;
};

export function ehRevisao(documento: { id: string; substituiId: string | null; familiaId: string }): boolean {
  return documento.substituiId !== null || documento.familiaId !== documento.id;
}

function rotuloDestino(linha: LinhaFila, contexto: ContextoFila): string {
  if (linha.projetoId) {
    const partes = [contexto.projetos.get(linha.projetoId) ?? "Projeto removido"];
    if (linha.categoriaId) partes.push(contexto.categorias.get(linha.categoriaId) ?? "Categoria removida");
    return partes.join(" › ");
  }
  if (linha.grupo === "arquivo" && linha.pastaRotulo) return `${ROTULO_GRUPO.arquivo} › ${linha.pastaRotulo}`;
  if (linha.grupo) return ROTULO_GRUPO[linha.grupo] ?? linha.grupo;
  return "Sem destino definido";
}

const ROTULO_PAPEL = { simo: "SIMO", laudo: "Laudo" } as const;

export function rotuloDeEquipamento(documento: { equipamento?: string | null; equipamentoPapel?: "simo" | "laudo" | null }): string | null {
  if (!documento.equipamento || !documento.equipamentoPapel) return null;
  return `${ROTULO_PAPEL[documento.equipamentoPapel]} · ${documento.equipamento}`;
}

export function montarFila(linhas: readonly LinhaFila[], contexto: ContextoFila): ItemFila[] {
  return linhas
    .filter((linha) => !contexto.comVersaoMaisNova.has(linha.id))
    .map((linha) => ({
      id: linha.id,
      titulo: linha.titulo,
      empreendimentoId: linha.empreendimentoId,
      empreendimentoNome: contexto.empreendimentos.get(linha.empreendimentoId) ?? null,
      destino: rotuloDestino(linha, contexto),
      equipamento: rotuloDeEquipamento(linha),
      tamanho: linha.tamanho,
      criadoEm: linha.criadoEm,
      origem: linha.caminhoRelativo,
      revisao: ehRevisao(linha) ? { visivel: contexto.visiveisPorFamilia.get(linha.familiaId) ?? null } : null,
      downloadHref: `/api/portal/documentos/${linha.id}/download`,
    }));
}

export type LinhaLote = {
  id: string;
  familiaId: string;
  substituiId: string | null;
  criadoEm: string;
  mime: string;
  liberado: boolean;
  temVersaoMaisNova: boolean;
};

export type PlanoLote = {
  // Têm anterior: passam pela função do banco que oculta a anterior na mesma transação.
  revisoes: string[];
  diretos: string[];
  ignorados: { id: string; motivo: string }[];
};

export type ResultadoLote = {
  liberados: string[];
  ignorados: PlanoLote["ignorados"];
  // Revisões que o banco recusou ou que falharam: continuam na fila e podem ser tentadas de novo.
  falhas: string[];
};

// `encontradas` traz só o que está na fila do servidor (oculto e com origem); o que faltar vira "fora da fila".
export function planejarLote(ids: readonly string[], encontradas: readonly LinhaLote[]): PlanoLote {
  const porId = new Map(encontradas.map((linha) => [linha.id, linha]));
  const ignorados: PlanoLote["ignorados"] = [];
  const elegiveis: LinhaLote[] = [];

  for (const id of ids) {
    const linha = porId.get(id);
    if (!linha) ignorados.push({ id, motivo: "Não está mais na fila (ignorado, removido ou não veio do servidor)." });
    else if (linha.liberado) ignorados.push({ id, motivo: "Já está liberado." });
    else if (linha.mime !== "application/pdf") ignorados.push({ id, motivo: "Só PDF pode ser liberado." });
    else if (linha.temVersaoMaisNova) ignorados.push({ id, motivo: "Existe uma versão mais nova deste arquivo." });
    else elegiveis.push(linha);
  }

  // Duas versões da mesma família no lote: só a mais nova sobe, para o cliente não passar por uma versão intermediária.
  const maisNovaDaFamilia = new Map<string, LinhaLote>();
  for (const linha of elegiveis) {
    const atual = maisNovaDaFamilia.get(linha.familiaId);
    if (!atual || linha.criadoEm > atual.criadoEm || (linha.criadoEm === atual.criadoEm && linha.id > atual.id)) {
      maisNovaDaFamilia.set(linha.familiaId, linha);
    }
  }

  const plano: PlanoLote = { revisoes: [], diretos: [], ignorados };
  for (const linha of elegiveis) {
    if (maisNovaDaFamilia.get(linha.familiaId) !== linha) {
      ignorados.push({ id: linha.id, motivo: "Outra versão do mesmo arquivo está no lote; só a mais nova é liberada." });
    } else if (ehRevisao(linha)) {
      plano.revisoes.push(linha.id);
    } else {
      plano.diretos.push(linha.id);
    }
  }
  return plano;
}
