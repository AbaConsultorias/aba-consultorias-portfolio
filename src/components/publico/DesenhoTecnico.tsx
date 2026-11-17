"use client";

import type { Servico } from "@/lib/conteudo/tipos";

import { motion } from "motion/react";
import { useMovimentoReduzido } from "./ganchos";
type Desenho = "arquitetonico" | "eletrico" | "hidrossanitario" | "generico";

const TRACOS: Record<Desenho, readonly string[]> = {
  generico: ["M40 130 V40 H200 V130 Z", "M40 85 H200", "M120 40 V130", "M30 145 H210"],
  arquitetonico: [
    "M14 140 H226",
    "M52 140 V82 H188 V140",
    "M40 88 L120 30 L200 88",
    "M158 58 V38 H172 V68",
    "M106 140 V104 H134 V140",
    "M66 100 H92 V124 H66 Z M79 100 V124",
    "M148 100 H174 V124 H148 Z M161 100 V124",
    "M52 152 H188 M52 147 V157 M188 147 V157",
  ],
  eletrico: [
    "M22 48 H62 V112 H22 Z",
    "M44 60 L34 80 H48 L38 100",
    "M62 70 H122 V52",
    "M110 40 A12 12 0 1 0 134 40 A12 12 0 1 0 110 40",
    "M122 18 V22 M100 40 H96 M148 40 H144 M106 24 L109 27 M138 24 L135 27",
    "M62 92 H172 V112",
    "M160 112 H184 V136 H160 Z M168 122 V126 M176 122 V126",
    "M122 70 H206 V58 M200 50 L212 50",
  ],
  hidrossanitario: [
    "M18 44 H118 V96 H222",
    "M58 44 V24 M50 24 H66",
    "M180 26 C 180 26 168 42 168 52 A12 12 0 0 0 192 52 C 192 42 180 26 180 26 Z",
    "M118 96 V70 H150",
    "M98 118 H142 V146 H98 Z",
    "M18 132 H98 M142 132 H222",
    "M196 124 L 214 132 L 196 140",
    "M26 150 H86",
  ],
};

const CODIGO: Record<Desenho, string> = {
  generico: "P-01",
  arquitetonico: "A-01",
  eletrico: "E-02",
  hidrossanitario: "H-03",
};

export function DesenhoTecnico({ desenho }: { desenho: Servico["icone"] }) {
  const reduzir = useMovimentoReduzido();
  const chave = desenho === "arquitetonico" || desenho === "eletrico" || desenho === "hidrossanitario" ? desenho : "generico";
  const tracos = TRACOS[chave];

  return (
    <svg viewBox="0 0 240 170" fill="none" aria-hidden="true" className="h-auto w-full text-(--nova-acento-claro)">
      <motion.g
        initial="oculto"
        whileInView="visivel"
        viewport={{ once: true, margin: "0px 0px -15% 0px" }}
        variants={{ visivel: { transition: { staggerChildren: reduzir ? 0 : 0.14 } }, oculto: {} }}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tracos.map((traco) => (
          <motion.path
            key={traco}
            d={traco}
            variants={{
              oculto: { pathLength: 0, opacity: 0 },
              visivel: {
                pathLength: 1,
                opacity: 1,
                transition: reduzir ? { duration: 0 } : { pathLength: { duration: 1.1, ease: [0.33, 1, 0.68, 1] }, opacity: { duration: 0.2 } },
              },
            }}
          />
        ))}
      </motion.g>
      <text x="226" y="166" textAnchor="end" className="fill-current font-mono text-[9px] tracking-[0.2em] opacity-70">
        {CODIGO[chave]}
      </text>
    </svg>
  );
}
