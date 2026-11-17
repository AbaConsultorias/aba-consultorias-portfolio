const FUSO = "America/Sao_Paulo";

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
const formatadorData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short" });

// Fuso fixo: o mesmo texto no servidor e no navegador, sem diferença de hidratação.
export function dataHoraSaoPaulo(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "—" : formatadorDataHora.format(data);
}

export function dataSaoPaulo(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "—" : formatadorData.format(data);
}

export function haQuantoTempo(iso: string, agora: Date): string {
  const minutos = Math.floor((agora.getTime() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutos) || minutos < 0) return "";
  if (minutos < 1) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} dias`;
}

const ROTULO_CONTAGEM: Record<string, string> = {
  examinados: "Examinados",
  enviados: "Enviados",
  ja_enviados: "Já enviados antes",
  duplicados: "Duplicados",
  recusados: "Recusados",
  erros: "Erros",
  aguardando_estabilidade: "Aguardando o arquivo estabilizar",
};

export const rotuloDaContagem = (nome: string): string => ROTULO_CONTAGEM[nome] ?? nome;

export const ROTULO_ESTADO_ENVIO: Record<string, string> = {
  autorizado: "Autorizado (aguardando envio)",
  confirmado: "Confirmado",
  recusado: "Recusado",
  duplicado: "Duplicado",
};
