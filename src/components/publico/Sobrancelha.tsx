import { cn } from "@/lib/utils";
import { Revelar } from "./Revelar";

export function Sobrancelha({
  numero,
  texto,
  tom = "escuro",
  className,
}: {
  numero: string;
  texto: string;
  tom?: "escuro" | "claro";
  className?: string;
}) {
  const claro = tom === "claro";
  return (
    <Revelar className={cn("flex items-center gap-4", className)}>
      <p className={cn("shrink-0 text-[11px] font-semibold tracking-[0.22em] uppercase sm:text-xs", claro ? "text-white/85" : "text-[#526B78]")}>
        <span className={claro ? "text-(--nova-acento-claro)" : "text-(--nova-acento)"}>{numero}</span>
        <span aria-hidden="true"> — </span>
        <span className="sr-only">, </span>
        {texto}
      </p>
      <span aria-hidden="true" className={cn("nova-linha h-px min-w-8 flex-1", claro ? "bg-white/25" : "bg-brand-dark/15")} />
    </Revelar>
  );
}
