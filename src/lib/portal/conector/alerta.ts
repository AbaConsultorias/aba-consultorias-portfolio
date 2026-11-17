const FUSO = "America/Sao_Paulo";
export const LIMITE_SILENCIO_MS = 24 * 60 * 60 * 1000;

const formatadorDiaDaSemana = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short" });

// Feriados não entram: num feriado em dia de semana o aviso aparece, o que é só um falso alarme.
export function ehDiaUtilEmSaoPaulo(agora: Date): boolean {
  const dia = formatadorDiaDaSemana.format(agora);
  return dia !== "Sat" && dia !== "Sun";
}

// Chave recém-emitida, ainda sem nenhum contato: conta o silêncio a partir da emissão, senão o aviso
// apareceria no mesmo instante em que a chave é criada.
export function conectorSilencioso(conector: { ultimoContatoEm: string | null; criadoEm: string }, agora: Date): boolean {
  const referencia = Date.parse(conector.ultimoContatoEm ?? conector.criadoEm);
  if (Number.isNaN(referencia)) return false;
  return agora.getTime() - referencia > LIMITE_SILENCIO_MS && ehDiaUtilEmSaoPaulo(agora);
}
