export type LinhaLoteDocumento = {
  id: string;
  familiaId: string;
  criadoEm: string;
  mime: string;
  liberado: boolean;
  // Existe uma revisão mais nova na família, dentro ou fora da seleção.
  temVersaoMaisNova: boolean;
};

export type IgnoradoNoLote = { id: string; motivo: string };

export type PlanoLoteDocumentos = {
  alterar: string[];
  ignorados: IgnoradoNoLote[];
};

export type ResultadoLoteDocumentos = {
  alterados: string[];
  ignorados: IgnoradoNoLote[];
  // O banco recusou ou a gravação falhou: o documento continua como estava e pode ser tentado de novo.
  falhas: string[];
};

const MOTIVOS = {
  naoEncontrado: "Documento não encontrado.",
  jaLiberado: "Já está liberado.",
  jaOculto: "Já está oculto.",
  naoPdf: "Só PDF pode ser liberado.",
  maisNovaNaSelecao: "Existe uma versão mais nova na seleção.",
  maisNova: "Existe uma versão mais nova deste arquivo.",
} as const;

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

// Date.parse perde os microssegundos do Postgres, e o texto cru depende do deslocamento da sessão e de zeros finais omitidos.
// Devolve UTC com a fração em 6 casas, que ordena como texto.
export function normalizarCriadoEm(texto: string): string {
  const partes = TIMESTAMP.exec(texto);
  if (!partes) return texto;
  const [, dia, hora, fracao = "", deslocamento] = partes;
  const deslocamentoIso = deslocamento === "Z" ? "Z" : `${deslocamento.slice(0, 3)}:${deslocamento.replace(":", "").slice(3, 5) || "00"}`;
  const segundos = Date.parse(`${dia}T${hora}${deslocamentoIso}`);
  if (Number.isNaN(segundos)) return texto;
  return `${new Date(segundos).toISOString().slice(0, 19)}.${fracao.padEnd(6, "0").slice(0, 6)}Z`;
}

// criado_em e, no empate, o id maior.
export function criadoDepois(a: { id: string; criadoEm: string }, b: { id: string; criadoEm: string }): boolean {
  const criadoA = normalizarCriadoEm(a.criadoEm);
  const criadoB = normalizarCriadoEm(b.criadoEm);
  return criadoA > criadoB || (criadoA === criadoB && a.id > b.id);
}

// `encontradas` traz só o que a sessão enxerga; o que faltar vira "não encontrado". Ao liberar, uma versão antiga nunca sobe
// por cima de uma mais nova (da seleção ou de fora dela): o trigger de família ocultaria a mais nova.
export function planejarAlteracaoEmLote(ids: readonly string[], encontradas: readonly LinhaLoteDocumento[], liberar: boolean): PlanoLoteDocumentos {
  const porId = new Map(encontradas.map((linha) => [linha.id, linha]));
  const plano: PlanoLoteDocumentos = { alterar: [], ignorados: [] };
  const ignorar = (id: string, motivo: string) => plano.ignorados.push({ id, motivo });

  for (const id of ids) {
    const linha = porId.get(id);
    if (!linha) ignorar(id, MOTIVOS.naoEncontrado);
    else if (linha.liberado === liberar) ignorar(id, liberar ? MOTIVOS.jaLiberado : MOTIVOS.jaOculto);
    else if (!liberar) plano.alterar.push(id);
    else if (linha.mime !== "application/pdf") ignorar(id, MOTIVOS.naoPdf);
    else if (encontradas.some((outra) => outra.familiaId === linha.familiaId && criadoDepois(outra, linha))) ignorar(id, MOTIVOS.maisNovaNaSelecao);
    else if (linha.temVersaoMaisNova) ignorar(id, MOTIVOS.maisNova);
    else plano.alterar.push(id);
  }
  return plano;
}

export function resumirLote(resultado: ResultadoLoteDocumentos, liberado: boolean): string {
  const partes = [`${resultado.alterados.length} ${liberado ? "liberado(s)" : "ocultado(s)"}`];
  if (resultado.ignorados.length > 0) {
    const motivos = [...new Set(resultado.ignorados.map((item) => item.motivo))].join(" ");
    partes.push(`${resultado.ignorados.length} não alterado(s): ${motivos}`);
  }
  if (resultado.falhas.length > 0) partes.push(`${resultado.falhas.length} com falha (tente de novo)`);
  return partes.join(" · ");
}
