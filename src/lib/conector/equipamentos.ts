import { chaveDoCaminho, normalizarCaminho, semAcentoEmMaiusculas } from "./regras";

export const MOTIVO_FORA_DO_PADRAO = "Fora do padrão de SIMOS e Laudos.";
export const TAMANHO_MAXIMO_EQUIPAMENTO = 160;

export type PapelDeEquipamento = "simo" | "laudo";
export type ClassificacaoDeEquipamento = { papel: PapelDeEquipamento; equipamento: string; pasta: string };

const CARACTERE_DE_CONTROLE = /[\u0000-\u001f\u007f-\u009f]/g;
// O número da frente só sai quando vem seguido de separador: "3D SCAN" mantém o "3D".
const NUMERO_DA_FRENTE = /^\s*\d+[\s.\-_–—)]+/;
// Só "LAUDO" (sem diferenciar caixa nem acento), como no contrato aprovado.
const PASTA_DE_LAUDO = "LAUDO";

// "01 - BOMBAS" vira "BOMBAS" e "03.PAINÉIS" vira "PAINÉIS". Se só sobrar o número, vale o nome inteiro da pasta.
export function nomeDoEquipamento(pasta: string): string {
  const limpar = (texto: string) => texto.normalize("NFC").replace(CARACTERE_DE_CONTROLE, " ").replace(/\s+/g, " ").trim();
  const cortar = (texto: string) => [...texto].slice(0, TAMANHO_MAXIMO_EQUIPAMENTO).join("").trim();
  const inteiro = limpar(pasta);
  const semNumero = limpar(inteiro.replace(NUMERO_DA_FRENTE, ""));
  return cortar(semNumero || inteiro) || "Equipamento";
}

// O prefixo é a pasta da regra "equipamentos" (comparado em fronteira de segmento, sem diferenciar caixa, como em
// casarRegra). Abaixo dele só valem dois formatos; qualquer outro caminho devolve null:
//   <equipamento>/SIMO....pdf         -> simo
//   <equipamento>/LAUDO/<x>.pdf       -> laudo (direto na pasta de laudo, sem subpastas)
export function classificarEquipamento(caminho: string, prefixo: string): ClassificacaoDeEquipamento | null {
  const segmentos = normalizarCaminho(caminho).split("/");
  const chaves = chaveDoCaminho(caminho).split("/");
  const chavesDoPrefixo = chaveDoCaminho(prefixo).split("/");
  if (chavesDoPrefixo.length >= segmentos.length || !chavesDoPrefixo.every((chave, i) => chave === chaves[i])) return null;

  const resto = segmentos.slice(chavesDoPrefixo.length);
  const [pasta, ...abaixo] = resto;
  if (abaixo.length === 1 && semAcentoEmMaiusculas(abaixo[0]).startsWith("SIMO")) {
    return { papel: "simo", equipamento: nomeDoEquipamento(pasta), pasta };
  }
  if (abaixo.length === 2 && semAcentoEmMaiusculas(abaixo[0]) === PASTA_DE_LAUDO) {
    return { papel: "laudo", equipamento: nomeDoEquipamento(pasta), pasta };
  }
  return null;
}
