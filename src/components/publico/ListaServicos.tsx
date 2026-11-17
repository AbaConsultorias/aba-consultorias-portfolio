"use client";

import type { Servico } from "@/lib/conteudo/tipos";

import { useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useScroll, useTransform } from "motion/react";
import { useMovimentoReduzido } from "./ganchos";
import { ArrowUpRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { SERIF } from "./Titulo";

const EASE = [0.33, 1, 0.68, 1] as const;

function numero(indice: number) {
  return String(indice + 1).padStart(2, "0");
}

function altTexto(servico: Servico) {
  return servico.titulo;
}

function LinkServico({ servico, claro = false }: { servico: Servico; claro?: boolean }) {
  return (
    <Link
      href={`/servicos/${servico.slug}`}
      className={cn(
        "group/link inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline-offset-4 transition-colors duration-500 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)",
        claro ? "text-white" : "text-brand-dark",
      )}
    >
      Conhecer este serviço
      <ArrowUpRight aria-hidden="true" className="size-4 transition-[translate] duration-500 group-hover/link:translate-x-1 group-hover/link:-translate-y-1 motion-reduce:group-hover/link:translate-x-0 motion-reduce:group-hover/link:translate-y-0" />
    </Link>
  );
}

function Itens({ itens, claro = false }: { itens: readonly string[]; claro?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {itens.map((item) => (
        <li
          key={item}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
            claro ? "border-white/25 bg-white/10 text-white" : "border-brand-dark/12 bg-white text-brand-dark",
          )}
        >
          <Check aria-hidden="true" className={cn("size-3.5", claro ? "text-(--nova-acento-claro)" : "text-(--nova-acento)")} />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ListaServicos({ servicos }: { servicos: Servico[] }) {
  const [ativo, setAtivo] = useState(0);
  const reduzir = useMovimentoReduzido();
  const painel = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: painel, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduzir ? ["0%", "0%"] : ["-6%", "6%"]);
  const servicoAtivo = servicos[ativo] ?? servicos[0];
  const duracao = reduzir ? 0 : 0.6;

  if (!servicoAtivo) return null;

  return (
    <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
      <ol className="border-b border-brand-dark/10">
        {servicos.map((servico, indice) => {
          const selecionado = indice === ativo;
          return (
            <li key={servico.titulo} className="relative border-t border-brand-dark/10">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-0 left-0 h-full w-[3px] origin-top rounded-full bg-(--nova-acento) transition-[scale] duration-700",
                  selecionado ? "scale-y-100" : "scale-y-0",
                )}
              />
              <button
                type="button"
                aria-expanded={selecionado}
                aria-controls={`servico-detalhe-${indice}`}
                onClick={() => setAtivo(indice)}
                onMouseEnter={() => setAtivo(indice)}
                onFocus={() => setAtivo(indice)}
                className="group flex w-full items-start gap-4 py-6 pr-1 pl-5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--nova-acento) sm:gap-6 sm:py-8 sm:pl-8"
              >
                <span className={cn("pt-1.5 text-xs font-semibold tabular-nums transition-colors duration-500 sm:pt-2.5", selecionado ? "text-(--nova-acento)" : "text-[#526B78]")}>
                  {numero(indice)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[1.45rem] leading-tight font-semibold tracking-[-0.03em] text-balance transition-[color,translate] duration-500 sm:text-3xl lg:text-[2.05rem]",
                      selecionado ? "translate-x-1 text-brand-dark motion-reduce:translate-x-0" : "text-[#526B78] group-hover:text-brand-dark",
                    )}
                  >
                    {servico.titulo}
                  </span>
                  <span className={cn(SERIF, "mt-1.5 block text-lg text-(--nova-acento) sm:text-xl")}>{servico.subtitulo}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1 grid size-11 shrink-0 place-items-center rounded-full transition-[translate,opacity,background-color,color] duration-500",
                    selecionado
                      ? "translate-x-0 bg-brand-dark text-white opacity-100"
                      : "-translate-x-4 bg-transparent text-brand-dark opacity-0 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:translate-x-0",
                  )}
                >
                  <ArrowUpRight className="size-5" />
                </span>
              </button>

              <motion.div
                id={`servico-detalhe-${indice}`}
                initial={false}
                animate={{ height: selecionado ? "auto" : 0, opacity: selecionado ? 1 : 0 }}
                transition={{ duration: duracao, ease: EASE }}
                inert={!selecionado}
                className="overflow-hidden lg:hidden"
              >
                <div className="space-y-5 pr-1 pb-8 pl-5 sm:pl-8">
                  <div className="relative aspect-[16/10] overflow-hidden rounded-2xl">
                    {servico.fotoUrl && <Image src={servico.fotoUrl} alt={altTexto(servico)} fill sizes="(max-width: 1023px) 92vw, 1px" className="object-cover" />}
                  </div>
                  <p className="text-base leading-7 text-[#526B78]">{servico.resumo}</p>
                  <Itens itens={servico.itens} />
                  <LinkServico servico={servico} />
                </div>
              </motion.div>
            </li>
          );
        })}
      </ol>

      <div ref={painel} className="hidden lg:block">
        <div className="sticky top-28">
          <div className="relative aspect-[4/5] max-h-[40rem] w-full overflow-hidden rounded-[2rem] bg-brand-dark">
            <motion.div style={{ y }} className="absolute inset-x-0 -top-[8%] -bottom-[8%]">
              {servicos.map((servico, indice) => (
                <motion.div
                  key={servico.titulo}
                  aria-hidden={indice !== ativo}
                  initial={false}
                  animate={{ opacity: indice === ativo ? 1 : 0, scale: indice === ativo || reduzir ? 1 : 1.08 }}
                  transition={{ duration: reduzir ? 0 : 0.9, ease: EASE }}
                  className="absolute inset-0"
                >
                  {servico.fotoUrl && <Image src={servico.fotoUrl} alt={altTexto(servico)} fill sizes="(min-width: 1280px) 520px, 42vw" className="object-cover" />}
                </motion.div>
              ))}
            </motion.div>
            <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-[#16222c]/85 via-[#16222c]/10 to-transparent" />

            <p className="absolute top-5 left-5 rounded-full bg-white/85 px-3.5 py-1.5 text-xs font-semibold tabular-nums text-brand-dark backdrop-blur-md">
              <span className="sr-only">Serviço </span>
              {numero(ativo)} <span aria-hidden="true" className="text-[#526B78]">/</span>
              <span className="sr-only"> de </span> {String(servicos.length).padStart(2, "0")}
            </p>

            <div aria-live="polite" className="absolute inset-x-0 bottom-0 p-7 text-white">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={ativo}
                  initial={{ opacity: 0, y: reduzir ? 0 : 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduzir ? 0 : -10 }}
                  transition={{ duration: reduzir ? 0 : 0.45, ease: EASE }}
                  className="space-y-4"
                >
                  <p className="text-xl font-semibold tracking-tight">{servicoAtivo.titulo}</p>
                  <p className="max-w-md text-sm leading-6 text-white/85">{servicoAtivo.resumo}</p>
                  <Itens itens={servicoAtivo.itens} claro />
                  <LinkServico servico={servicoAtivo} claro />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
