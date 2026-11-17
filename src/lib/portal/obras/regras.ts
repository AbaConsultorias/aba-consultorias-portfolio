import type { RelatoObra, SituacaoObra, StatusRelato } from "./tipos";

export const LIMITE_FOTOS_RELATO = 10;
export const LIMITE_PENDENTES_RELATO = 5;
export const SITUACOES_OBRA = [
  { valor: "planejada", nome: "Planejada" },
  { valor: "em_andamento", nome: "Em andamento" },
  { valor: "concluida", nome: "Concluída" },
] as const;
export function rotuloStatus(status: StatusRelato): string {
  return { pendente: "Pendente", aprovado: "Aprovado", devolvido: "Devolvido" }[status];
}
export function rotuloSituacao(situacao: SituacaoObra): string {
  return SITUACOES_OBRA.find((item) => item.valor === situacao)!.nome;
}
export function sugerirRevisao(
  relato: Pick<RelatoObra, "percentualInformado" | "situacaoInformada">,
  obra: { percentual: number; situacao: SituacaoObra },
): { percentual: number; situacao: SituacaoObra } {
  return { percentual: relato.percentualInformado ?? obra.percentual, situacao: relato.situacaoInformada ?? obra.situacao };
}
export function avisoDeConsistencia(percentual: number, situacao: SituacaoObra): string | null {
  if (situacao === "concluida" && percentual < 100) return "A obra está concluída, mas o percentual é menor que 100%. Confira antes de aprovar.";
  if (situacao === "planejada" && percentual > 0) return "A obra está planejada, mas já tem progresso informado. Confira antes de aprovar.";
  return null;
}
