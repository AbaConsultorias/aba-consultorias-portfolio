import type { ReactNode } from "react";
import { Archive, CircleCheck, CircleDashed, CirclePlay, CircleX, Clock, Undo2, type LucideIcon } from "lucide-react";

type Tom = "aviso" | "ok" | "erro" | "info" | "neutro";
const SELOS: Record<string, { tom: Tom; Icone: LucideIcon }> = {
  pendente: { tom: "aviso", Icone: Clock },
  aprovado: { tom: "ok", Icone: CircleCheck },
  devolvido: { tom: "erro", Icone: Undo2 },
  recusado: { tom: "erro", Icone: CircleX },
  planejada: { tom: "neutro", Icone: CircleDashed },
  em_andamento: { tom: "info", Icone: CirclePlay },
  concluida: { tom: "ok", Icone: CircleCheck },
  ativo: { tom: "info", Icone: CirclePlay },
  concluido: { tom: "ok", Icone: CircleCheck },
  arquivado: { tom: "neutro", Icone: Archive },
};

export function SeloSituacao({ situacao, children, className }: { situacao: string; children: ReactNode; className?: string }) {
  const { tom, Icone } = SELOS[situacao] ?? { tom: "neutro", Icone: CircleDashed };
  return <span className={className ? `portal-selo ${className}` : "portal-selo"} data-tom={tom} data-situacao={situacao}><Icone size={14} aria-hidden="true" />{children}</span>;
}
