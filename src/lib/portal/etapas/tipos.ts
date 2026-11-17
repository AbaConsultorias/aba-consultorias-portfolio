// Sugestões e histórico das etapas pelas pastas (docs/ETAPAS-AUTOMATICAS-CONTRATO.md). Só o admin lê isto: o cliente
// continua vendo apenas a etapa atual do projeto, nunca o sinal, o histórico nem o nome do arquivo.
import type { ModoDeEtapas } from "@/lib/portal/pasta/tipos";

export type TipoDeSinal = "protocolo" | "devolutiva" | "aprovado";
export type OrigemDaMudanca = "manual" | "sugestao" | "automatico" | "recalculo" | "desfazer";

export type SugestaoDeEtapa = {
  sinalId: string;
  tipo: TipoDeSinal;
  etapaId: string;
  etapaNome: string;
  // Data do arquivo informada pelo servidor (instante ISO), não a hora em que o site leu.
  dataArquivo: string;
  // Nome do arquivo (sem a pasta). null quando a pessoa não pode ler documentos ou o documento sumiu.
  arquivo: string | null;
};

export type MudancaDeEtapa = {
  id: string;
  origem: OrigemDaMudanca;
  deEtapaNome: string | null;
  paraEtapaNome: string | null;
  arquivo: string | null;
  porNome: string | null;
  em: string;
  desfeita: boolean;
  podeDesfazer: boolean;
};

export type SugestaoDoRecalculo = {
  projetoId: string;
  // O sinal que a pessoa vê na lista; vai de volta no confirmar para o banco não aplicar uma sugestão que mudou.
  sinalId: string;
  projetoNome: string;
  deEtapaNome: string | null;
  paraEtapaNome: string;
  dataArquivo: string;
  arquivo: string | null;
};

export type EtapasDoProjeto = {
  modo: ModoDeEtapas;
  sugestao: SugestaoDeEtapa | null;
  historico: MudancaDeEtapa[];
};

export const ROTULO_DA_ORIGEM: Record<OrigemDaMudanca, string> = {
  manual: "Manual",
  sugestao: "Sugestão confirmada",
  automatico: "Automática",
  recalculo: "Recalculada",
  desfazer: "Desfeita",
};

export const ROTULO_DO_MODO: Record<ModoDeEtapas, string> = {
  desligado: "Desligada",
  sugerir: "Sugerir",
  automatico: "Automática",
};

// Nome de arquivo vem do servidor da empresa: mostrado sempre como texto e com tamanho limitado.
export const TAMANHO_MAXIMO_EXIBIDO = 120;
export function limitarTexto(texto: string, maximo = TAMANHO_MAXIMO_EXIBIDO): string {
  const caracteres = [...texto.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()];
  return caracteres.length > maximo ? `${caracteres.slice(0, maximo).join("")}…` : caracteres.join("");
}
