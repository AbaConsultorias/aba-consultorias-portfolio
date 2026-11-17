import type { LoteamentoResumo } from "@/lib/conteudo/tipos";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

import { SERIF } from "./Titulo";

function Sequencia({ loteamentos, copia = false }: { loteamentos: LoteamentoResumo[]; copia?: boolean }) {
  return (
    <ul aria-hidden={copia || undefined} className={cn("flex shrink-0 items-center", copia && "nova-marquee-copia")}>
      {loteamentos.map(({ nome, cidade }, indice) => (
        <li key={nome} className="flex shrink-0 items-center">
          <span
            className={cn(
              "px-6 text-4xl font-semibold tracking-[-0.04em] whitespace-nowrap transition-colors duration-500 hover:text-(--nova-acento) sm:px-10 sm:text-6xl lg:text-7xl",
              indice % 2 === 1 ? cn(SERIF, "text-[#748A94]") : "text-brand-dark",
            )}
          >
            {nome}
            <span className="sr-only">, {cidade}</span>
          </span>
          <span aria-hidden="true" className="size-2.5 shrink-0 rotate-45 bg-(--nova-acento) sm:size-3" />
        </li>
      ))}
    </ul>
  );
}

export function FaixaLoteamentos({ loteamentos }: { loteamentos: LoteamentoResumo[] }) {
  if (!loteamentos.length) return null;
  return (
    <section aria-label="Loteamentos atendidos pela ABA" className="overflow-hidden border-y border-brand-dark/10 bg-white py-10 sm:py-14">
      <p className="mx-auto max-w-7xl px-5 text-[11px] font-semibold tracking-[0.22em] text-[#526B78] uppercase sm:px-8 sm:text-xs">
        Loteamentos atendidos
      </p>
      <div className="nova-marquee mt-6 flex overflow-hidden" style={{ "--duracao": "55s" } as CSSProperties}>
        <div className="nova-marquee-trilha flex w-max">
          <Sequencia loteamentos={loteamentos} />
          <Sequencia loteamentos={loteamentos} copia />
        </div>
      </div>
    </section>
  );
}
