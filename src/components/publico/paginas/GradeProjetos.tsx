"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import type { CategoriaProjeto, ProjetoResumo } from "@/lib/conteudo/tipos";
import { useMovimentoReduzido } from "../ganchos";

export const CATEGORIAS: Record<CategoriaProjeto, string> = {
  loteamento: "Loteamentos", residencial: "Residenciais", obra_copasa: "Obras Copasa", outro: "Outros projetos",
};

export function GradeProjetos({ projetos }: { projetos: ProjetoResumo[] }) {
  const [categoria, setCategoria] = useState<CategoriaProjeto | "todos">("todos");
  const reduzir = useMovimentoReduzido();
  const visiveis = projetos.filter((p) => categoria === "todos" || p.categoria === categoria);
  const filtros = ["todos", ...Object.keys(CATEGORIAS).filter((c) => projetos.some((p) => p.categoria === c))] as (CategoriaProjeto | "todos")[];
  return <>
    <div role="group" aria-label="Filtrar projetos por categoria" className="flex flex-wrap gap-3">
      {filtros.map((valor) => <button key={valor} type="button" aria-pressed={categoria === valor} onClick={() => setCategoria(valor)} className={`min-h-11 rounded-full border px-5 py-2 text-sm font-semibold transition-colors duration-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand ${categoria === valor ? "border-brand-dark bg-brand-dark text-white" : "border-brand-dark/20 bg-white text-brand-dark hover:border-brand hover:bg-brand/10"}`}>{valor === "todos" ? "Todos os projetos" : CATEGORIAS[valor]}</button>)}
    </div>
    <p role="status" className="mt-6 text-sm text-[#526B78]">{visiveis.length} {visiveis.length === 1 ? "projeto" : "projetos"}</p>
    <motion.ul layout={!reduzir} className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {visiveis.map((p) => <motion.li key={p.id} layout={!reduzir} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduzir ? 0 : 0.45, ease: [0.33, 1, 0.68, 1] }} className="min-w-0">
          <Link href={`/projetos/${p.slug}`} className="group block rounded-[1.75rem] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-brand-dark/10">
              {p.capaUrl ? <Image src={p.capaUrl} alt={`Projeto ${p.titulo}${p.cidade ? ` em ${p.cidade}` : ""}`} fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:group-hover:transform-none" /> : <span className="absolute inset-0 grid place-items-center text-sm text-[#526B78]">{CATEGORIAS[p.categoria]}</span>}
              <span aria-hidden="true" className="absolute right-4 bottom-4 grid size-11 place-items-center rounded-full bg-white text-brand-dark transition-colors duration-500 group-hover:bg-brand-dark group-hover:text-white"><ArrowUpRight className="size-5" /></span>
            </div>
            <p className="mt-5 text-xs font-semibold tracking-wider text-(--nova-acento) uppercase">{CATEGORIAS[p.categoria]}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight break-words">{p.titulo}</h2>
            {p.cidade && <p className="mt-2 text-sm text-[#526B78]">{p.cidade}</p>}
          </Link>
        </motion.li>)}
      </AnimatePresence>
    </motion.ul>
    {!projetos.length && <p className="py-12 text-[#526B78]">Em breve, novos projetos por aqui. Converse com a equipe para conhecer nosso trabalho.</p>}
  </>;
}
