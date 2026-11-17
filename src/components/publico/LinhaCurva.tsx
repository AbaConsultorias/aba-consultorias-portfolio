"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { useMovimentoReduzido } from "./ganchos";
import { cn } from "@/lib/utils";

const TRACADOS = {
  onda: "M-40 120 C 260 40, 420 360, 720 260 S 1180 40, 1480 220",
  laco: "M1480 80 C 1180 160, 1060 420, 820 380 S 420 120, 260 300 S 60 520, -40 480",
} as const;

export function LinhaCurva({ tracado = "onda", className }: { tracado?: keyof typeof TRACADOS; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduzir = useMovimentoReduzido();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const comprimento = useTransform(scrollYProgress, [0, 1], [reduzir ? 1 : 0.05, 1]);

  return (
    <div ref={ref} aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 -z-10 h-[28rem] overflow-hidden", className)}>
      <svg viewBox="0 0 1440 480" preserveAspectRatio="xMidYMid slice" fill="none" className="size-full">
        <motion.path d={TRACADOS[tracado]} stroke="currentColor" strokeWidth="1.2" style={{ pathLength: comprimento }} />
      </svg>
    </div>
  );
}
