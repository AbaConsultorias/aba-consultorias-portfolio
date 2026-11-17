"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView } from "motion/react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMovimentoReduzido } from "./ganchos";
import { SERIF } from "./Titulo";

const EASE = [0.33, 1, 0.68, 1] as const;

function formatarNota(valor: number) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function NotaGoogle({ nota, total }: { nota: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const visivel = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const reduzir = useMovimentoReduzido();
  // O HTML do servidor traz os valores finais; só depois de hidratar, e se o bloco ainda está
  // fora da tela, ele "arma" a contagem voltando a zero.
  const [armado, setArmado] = useState(false);
  const [progresso, setProgresso] = useState(1);

  useEffect(() => {
    if (reduzir || visivel || armado) return;
    const quadro = requestAnimationFrame(() => {
      setArmado(true);
      setProgresso(0);
    });
    return () => cancelAnimationFrame(quadro);
  }, [reduzir, visivel, armado]);

  useEffect(() => {
    if (!armado || !visivel) return;
    const controle = animate(0, 1, { duration: 2, ease: EASE, onUpdate: setProgresso });
    return () => controle.stop();
  }, [armado, visivel]);

  const fracao = reduzir ? 1 : progresso;
  const estrelasCheias = reduzir || !armado || visivel;

  return (
    <div ref={ref}>
      <p className="sr-only">
        Nota {formatarNota(nota)} de 5 no Google, com {total} avaliações.
      </p>
      <div aria-hidden="true" className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <span className={cn(SERIF, "text-[7rem] leading-[0.8] text-brand-dark tabular-nums sm:text-[9rem]")}>
          {formatarNota(Math.round(nota * fracao * 10) / 10)}
        </span>
        <div className="pb-2">
          <div className="flex gap-1">
            {Array.from({ length: 5 }, (_, indice) => (
              <span key={indice} className="relative size-6 sm:size-7">
                <Star className="absolute inset-0 size-full text-[#99A6AD]" strokeWidth={1.5} />
                <motion.span
                  initial={false}
                  animate={{ clipPath: estrelasCheias ? `inset(0 ${100 - Math.max(0, Math.min(1, nota - indice)) * 100}% 0 0)` : "inset(0 100% 0 0)" }}
                  transition={{ duration: reduzir || !armado ? 0 : 0.5, delay: reduzir || !armado ? 0 : 0.4 + indice * 0.18, ease: EASE }}
                  className="absolute inset-0"
                >
                  <Star className="size-full fill-[#F4B400] text-[#F4B400]" strokeWidth={1.5} />
                </motion.span>
              </span>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold text-brand-dark">
            <span className="tabular-nums">{Math.round(total * fracao)}</span> avaliações no Google
          </p>
        </div>
      </div>
    </div>
  );
}
