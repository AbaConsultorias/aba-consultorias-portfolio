"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoteamentoResumo } from "@/lib/conteudo/tipos";
import { useMovimentoReduzido } from "../ganchos";

const EASE = [0.33, 1, 0.68, 1] as const;
const TODAS = "Todas";

export function CatalogoLoteamentos({ loteamentos }: { loteamentos: LoteamentoResumo[] }) {
  const reduzir = useMovimentoReduzido();
  const [cidadeAtiva, setCidadeAtiva] = useState(TODAS);

  const cidades = useMemo(() => {
    const vistas: string[] = [];
    for (const { cidade } of loteamentos) if (cidade && !vistas.includes(cidade)) vistas.push(cidade);
    return vistas;
  }, [loteamentos]);

  const resultado = cidadeAtiva === TODAS ? loteamentos : loteamentos.filter(({ cidade }) => cidade === cidadeAtiva);

  return (
    <div>
      {cidades.length > 1 && (
        <fieldset className="min-w-0">
          <legend className="sr-only">Filtrar loteamentos por cidade</legend>
          <div className="flex flex-wrap gap-2">
            {[TODAS, ...cidades].map((cidade) => {
              const ativa = cidadeAtiva === cidade;
              return (
                <button
                  key={cidade}
                  type="button"
                  aria-pressed={ativa}
                  aria-controls="catalogo-resultados"
                  onClick={() => setCidadeAtiva(cidade)}
                  className={cn(
                    "min-h-11 max-w-full rounded-full border px-4 text-sm font-semibold transition-[background-color,color,border-color] duration-500",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--nova-acento)",
                    ativa ? "border-brand-dark bg-brand-dark text-white" : "border-brand-dark/15 bg-white text-brand-dark hover:border-brand-dark/40",
                  )}
                >
                  {cidade}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <p role="status" aria-live="polite" aria-atomic="true" className="mt-6 text-sm text-[#526B78]">
        {resultado.length} {resultado.length === 1 ? "loteamento" : "loteamentos"}
        {cidadeAtiva !== TODAS && ` em ${cidadeAtiva}`}
      </p>

      <motion.ul id="catalogo-resultados" layout={!reduzir} className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {resultado.map((loteamento) => {
            const foto = loteamento.capaUrl ?? loteamento.bannerUrl;
            return (
              <motion.li
                key={loteamento.id}
                layout={reduzir ? false : "position"}
                initial={reduzir ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduzir ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="min-w-0"
              >
                <article className="group h-full overflow-hidden rounded-[1.75rem] border border-brand-dark/8 bg-white transition-[translate,box-shadow,border-color] duration-500 hover:-translate-y-1.5 hover:border-brand-dark/15 hover:shadow-[0_30px_60px_-34px_rgba(40,84,104,0.55)] motion-reduce:hover:translate-y-0">
                  <Link
                    href={`/loteamentos/${loteamento.slug}`}
                    className="block h-full rounded-[1.75rem] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-brand-dark/10">
                      {foto && (
                        <Image
                          src={foto}
                          alt={`Vista do loteamento ${loteamento.nome}${loteamento.cidade ? `, em ${loteamento.cidade}` : ""}`}
                          fill
                          sizes="(max-width: 639px) 92vw, (max-width: 1023px) 46vw, 400px"
                          className="object-cover transition-[scale] duration-[900ms] group-hover:scale-[1.07] motion-reduce:group-hover:scale-100"
                        />
                      )}
                      <span
                        className={cn(
                          "absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm",
                          loteamento.lotesDisponiveis > 0 ? "bg-white text-emerald-800" : "bg-white/90 text-brand-dark",
                        )}
                      >
                        {loteamento.lotesDisponiveis > 0 && <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600" />}
                        {loteamento.lotesDisponiveis > 0
                          ? `${loteamento.lotesDisponiveis} ${loteamento.lotesDisponiveis === 1 ? "lote disponível" : "lotes disponíveis"}`
                          : "Consulte disponibilidade"}
                      </span>
                    </div>
                    <div className="p-6">
                      {loteamento.cidade && (
                        <p className="flex items-start gap-1.5 text-xs text-[#526B78]">
                          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                          {loteamento.cidade}
                        </p>
                      )}
                      <h3 className="mt-2 text-xl font-semibold tracking-tight text-brand-dark">{loteamento.nome}</h3>
                      <div className="mt-5 flex items-center justify-between border-t border-brand-dark/10 pt-4 text-sm font-semibold text-brand">
                        Conhecer loteamento
                        <span
                          aria-hidden="true"
                          className="grid size-9 place-items-center rounded-full bg-(--nova-fundo) transition-[background-color,color,rotate] duration-500 group-hover:rotate-45 group-hover:bg-brand-dark group-hover:text-white motion-reduce:group-hover:rotate-0"
                        >
                          <ArrowUpRight className="size-4" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </article>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>
    </div>
  );
}
