import { LIMITE_PDF_BYTES } from "../portal/documentos/regras";

export { LIMITE_PDF_BYTES };
export const VERSAO_API = 1;
// Mesma lista do contrato (docs/ETAPA-7-API-CONECTOR.md §1) e do CHECK pasta_regras_bloqueio_check.
export const BLOQUEIO = ["DADOS DO EMPREENDEDOR", "COMPROVANTE", "NOTAS FISCAIS", "PLANILHA"] as const;
export const TAMANHO_MAXIMO_CAMINHO = 1000;

const CARACTERE_DE_CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
const SUBSTITUTO_ISOLADO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export type RegraDeCaminho = { id: string; caminho_prefixo: string };
export type CaminhoValidado = { valido: true; caminho: string } | { valido: false; motivo: string };

export function contemCaractereInvalido(texto: string): boolean {
  return CARACTERE_DE_CONTROLE.test(texto) || SUBSTITUTO_ISOLADO.test(texto);
}

// NFC e "/" como separador. Não valida: use validarCaminho.
export function normalizarCaminho(caminho: string): string {
  return caminho.normalize("NFC").replace(/\\/g, "/");
}

// Chave de comparação: o Windows não diferencia maiúsculas de minúsculas.
export function chaveDoCaminho(caminho: string): string {
  return normalizarCaminho(caminho).toLowerCase();
}

export function semAcentoEmMaiusculas(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

// Para a lista de bloqueio: NFKD (dobra também letras de largura total), sem acento, maiúsculas e só letras e
// dígitos, para "NOTAS  FISCAIS", "NOTAS-FISCAIS" ou "NOTAS_FISCAIS" não escaparem de "NOTAS FISCAIS".
export function chaveDeBloqueio(texto: string): string {
  return texto.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const CHAVES_DE_BLOQUEIO = BLOQUEIO.map(chaveDeBloqueio);

export function segmentoBloqueado(segmento: string): boolean {
  const comparavel = chaveDeBloqueio(segmento);
  return CHAVES_DE_BLOQUEIO.some((termo) => comparavel.includes(termo));
}

export function caminhoBloqueado(caminho: string): boolean {
  return normalizarCaminho(caminho).split("/").some(segmentoBloqueado);
}

export function caminhoDePastaValido(caminho: string, maximoSegmentos = Number.POSITIVE_INFINITY): boolean {
  if (caminho.length === 0 || [...caminho].length > TAMANHO_MAXIMO_CAMINHO) return false;
  // A árvore vem com "/" e relativa: "\" (inclui UNC), ":" (unidade) e "/" inicial (absoluto, UNC com //) não entram.
  if (contemCaractereInvalido(caminho) || caminho.includes(":") || caminho.includes("\\") || caminho.startsWith("/")) return false;
  const segmentos = caminho.split("/");
  return segmentos.length <= maximoSegmentos && segmentos.every((segmento) => segmento !== "" && segmento !== "." && segmento !== "..");
}

// O site não confia no programa do servidor: normaliza e revalida tudo, mesmo o que ele já filtrou.
export function validarCaminho(bruto: string): CaminhoValidado {
  if (contemCaractereInvalido(bruto)) return { valido: false, motivo: "Caminho com caracteres inválidos." };
  const caminho = normalizarCaminho(bruto);
  if ([...caminho].length > TAMANHO_MAXIMO_CAMINHO) return { valido: false, motivo: "Caminho longo demais." };
  if (caminho.includes(":")) return { valido: false, motivo: "Caminho não pode ter unidade ou \":\"." };
  const segmentos = caminho.split("/");
  if (segmentos.some((segmento) => segmento === "" || segmento === "." || segmento === "..")) {
    return { valido: false, motivo: "Caminho inválido." };
  }
  if (!/\.pdf$/i.test(caminho) || segmentos[segmentos.length - 1].length <= ".pdf".length) {
    return { valido: false, motivo: "Só arquivos PDF são aceitos." };
  }
  return { valido: true, caminho };
}

// Prefixo em fronteira de segmento, sem diferenciar caixa; o prefixo mais longo vence.
export function casarRegra<T extends RegraDeCaminho>(caminho: string, regras: readonly T[]): T | null {
  const segmentos = chaveDoCaminho(caminho).split("/");
  let melhor: { regra: T; tamanho: number } | null = null;
  for (const regra of regras) {
    const prefixo = chaveDoCaminho(regra.caminho_prefixo).split("/");
    if (prefixo.length > segmentos.length || !prefixo.every((segmento, i) => segmento === segmentos[i])) continue;
    const vence = melhor === null || prefixo.length > melhor.tamanho
      || (prefixo.length === melhor.tamanho && regra.id < melhor.regra.id);
    if (vence) melhor = { regra, tamanho: prefixo.length };
  }
  return melhor?.regra ?? null;
}

// Título do documento: nome do arquivo sem .pdf, até 160 caracteres.
export function tituloDoCaminho(caminho: string): string {
  const nome = normalizarCaminho(caminho).split("/").pop() ?? "";
  const base = nome
    .replace(/\.pdf$/i, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...(base || "Documento")].slice(0, 160).join("").trim() || "Documento";
}

// Mensagens de erro do programa não podem trazer caminho do servidor. Nome de pasta tem espaço, então a limpeza não
// para no primeiro espaço: unidade (C:\ ou C:/), UNC (\\srv) e "//" valem até o fim da mensagem, e um trecho com 2 ou
// mais separadores seguidos de texto (caminho relativo) também.
export function limparMensagem(texto: string): string {
  return texto
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd")
    .replace(/(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\|\/\/)[\s\S]*/, "[caminho]")
    .replace(/[^\s\\/]*(?:[\\/][^\\/]*){2,}/, "[caminho]")
    .trim();
}

// Caminho recusado também é registrado em conector_envios (1 a 2000 caracteres, sem NUL).
export function caminhoParaRegistro(bruto: string): string {
  const limpo = [...bruto.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "?")]
    .slice(0, 2000)
    .join("");
  return limpo === "" ? "(vazio)" : limpo;
}

export const LIMITE_REQUISICOES_POR_HORA = 600;
export const LIMITE_ENVIOS_POR_DIA = 200;
export const LIMITE_BYTES_POR_DIA = 2 * 1024 * 1024 * 1024;
export const VALIDADE_DA_AUTORIZACAO_MS = 5 * 60 * 1000;
export const PRAZO_PARA_CONFIRMAR_MS = 60 * 60 * 1000;
// A janela móvel de 24 h dos dois limites acima é contada no banco (reservar_envio_conector), de forma atômica.
