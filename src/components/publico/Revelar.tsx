"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";

const CLASSE_DO_EFEITO = {
  subir: "nova-revelar",
  palavras: "nova-titulo",
  gatilho: "",
} as const;

type Efeito = keyof typeof CLASSE_DO_EFEITO;

// O estado oculto vive no CSS (nova.css), que também o desfaz sem JS e com movimento reduzido.
export function Revelar({
  children,
  efeito = "subir",
  atraso = 0,
  className,
  style,
}: {
  children: ReactNode;
  efeito?: Efeito;
  atraso?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visivel = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });

  return (
    <div
      ref={ref}
      data-visivel={visivel ? "" : undefined}
      style={{ ...style, "--atraso": `${atraso}ms` } as CSSProperties}
      className={cn(CLASSE_DO_EFEITO[efeito], className)}
    >
      {children}
    </div>
  );
}
