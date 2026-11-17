import { cn } from "@/lib/utils";
import type { StatusLote } from "@/lib/conteudo/tipos";
import { ESTILO_STATUS, ROTULO_STATUS } from "./lotes";

export function BadgeStatus({ status, className }: { status: StatusLote; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", ESTILO_STATUS[status].badge, className)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", ESTILO_STATUS[status].ponto)} />
      {ROTULO_STATUS[status]}
    </span>
  );
}
