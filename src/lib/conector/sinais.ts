import { chaveDoCaminho, normalizarCaminho, semAcentoEmMaiusculas } from "./regras";

// Filtro de caminho das regras que marcam etapa (docs/ETAPAS-AUTOMATICAS-CONTRATO.md §3). Sem I/O: o conector usa o mesmo
// resultado ao autorizar o envio e ao confirmar, e a montagem só deriva regras de pastas que o filtro aceitaria.

export const MOTIVO_PROTOCOLO_FORA_DO_PADRAO = "Fora do padrão de protocolos.";
export const MOTIVO_DEVOLUTIVA_FORA_DO_PADRAO = "Fora do padrão de devolutivas.";
export const MOTIVO_PASTA_IGNORADA = "Pasta ignorada (99 - OUTROS / antigos).";
export const MOTIVO_PASTA_FINANCEIRA = "Pasta financeira dentro de um projeto (FINANCEIRO).";

const NUMERO_99_NA_FRENTE = /^99\s*[-–—]/;
const PALAVRA_OUTROS = /(?<![A-Z0-9])OUTROS(?![A-Z0-9])/;

function prefixoDoCaminho(caminho: string, prefixo: string): string[] | null {
  const segmentos = normalizarCaminho(caminho).split("/");
  const chaves = chaveDoCaminho(caminho).split("/");
  const chavesDoPrefixo = chaveDoCaminho(prefixo).split("/");
  if (chavesDoPrefixo.length >= segmentos.length || !chavesDoPrefixo.every((chave, i) => chave === chaves[i])) return null;
  return segmentos.slice(chavesDoPrefixo.length);
}

// "99 - OUTROS", "OUTROS", "03 - OUTROS PROJETOS" e "ANTIGO/ANTIGOS/ANTIGAS" (qualquer coisa com ANTIG). Só pastas: o
// nome do arquivo (último segmento) nunca conta.
export function pastaIgnorada(caminho: string): boolean {
  return normalizarCaminho(caminho).split("/").slice(0, -1).some((segmento) => {
    const nome = semAcentoEmMaiusculas(segmento).trim();
    return NUMERO_99_NA_FRENTE.test(nome) || PALAVRA_OUTROS.test(nome) || nome.includes("ANTIG");
  });
}

// Pasta com FINANCEIRO no nome abaixo do prefixo da regra. O prefixo em si não conta (as regras de contratos e de
// orçamentos ficam em 02 - FINANCEIRO) e o nome do arquivo (último segmento) também não.
export function pastaFinanceiraAbaixoDoPrefixo(caminho: string, prefixo: string): boolean {
  const resto = prefixoDoCaminho(caminho, prefixo);
  return resto !== null && resto.slice(0, -1).some((segmento) => semAcentoEmMaiusculas(segmento).includes("FINANCEIRO"));
}

// Regra "protocolos" (prefixo = pasta PROJETOS do produto): só o PDF dentro de uma subpasta cujo nome tem PROTOCOLO.
export function caminhoDeProtocolo(caminho: string, prefixo: string): boolean {
  const resto = prefixoDoCaminho(caminho, prefixo);
  return resto !== null && resto.length >= 2 && semAcentoEmMaiusculas(resto[0]).includes("PROTOCOLO");
}

// Regra "devolutivas" (prefixo = pasta LAN): só o PDF solto na LAN, sem subpasta (o APROVADO tem regra própria).
export function caminhoDeDevolutiva(caminho: string, prefixo: string): boolean {
  return prefixoDoCaminho(caminho, prefixo)?.length === 1;
}

// Motivo fixo da recusa, ou null quando o caminho serve. A pasta ignorada e a financeira valem para qualquer tipo de
// regra; o formato de protocolos e de devolutivas, só para o tipo respectivo (comum e equipamentos seguem as próprias regras).
export function motivoDeRecusaDoCaminho(caminho: string, regra: { tipo?: string; caminho_prefixo: string }): string | null {
  if (pastaIgnorada(caminho)) return MOTIVO_PASTA_IGNORADA;
  if (pastaFinanceiraAbaixoDoPrefixo(caminho, regra.caminho_prefixo)) return MOTIVO_PASTA_FINANCEIRA;
  if (regra.tipo === "protocolos" && !caminhoDeProtocolo(caminho, regra.caminho_prefixo)) return MOTIVO_PROTOCOLO_FORA_DO_PADRAO;
  if (regra.tipo === "devolutivas" && !caminhoDeDevolutiva(caminho, regra.caminho_prefixo)) return MOTIVO_DEVOLUTIVA_FORA_DO_PADRAO;
  return null;
}
