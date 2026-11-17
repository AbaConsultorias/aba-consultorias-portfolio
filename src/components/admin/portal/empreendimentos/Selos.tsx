import type { ReactNode } from "react";

export type SituacaoEmpreendimento = "ativo" | "concluido" | "arquivado";

const SITUACAO: Record<SituacaoEmpreendimento, { nome: string; tom: "ok" | "info" | "neutro" }> = {
  ativo: { nome: "Ativo", tom: "ok" },
  concluido: { nome: "Concluído", tom: "info" },
  arquivado: { nome: "Arquivado", tom: "neutro" },
};

export function Selo({ tom, children }: { tom: "ok" | "aviso" | "info" | "neutro"; children: ReactNode }) {
  return <span className="portal-selo min-w-0 [overflow-wrap:anywhere]" data-tom={tom}>{children}</span>;
}

export function SeloSituacao({ situacao }: { situacao: SituacaoEmpreendimento }) {
  return <Selo tom={SITUACAO[situacao].tom}>{SITUACAO[situacao].nome}</Selo>;
}

export function plural(quantidade: number, singular: string, pluralDe: string) {
  return `${quantidade} ${quantidade === 1 ? singular : pluralDe}`;
}
