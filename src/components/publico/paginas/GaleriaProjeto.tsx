"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import type { Midia } from "@/lib/conteudo/tipos";
import { useMovimentoReduzido } from "../ganchos";

const CONTROLE = "grid size-12 shrink-0 place-items-center rounded-full border border-white/30 bg-brand-dark text-white transition-colors duration-500 hover:bg-white hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

export function GaleriaProjeto({ midias, titulo }: { midias: Midia[]; titulo: string }) {
  const [indice, setIndice] = useState<number | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const origem = useRef<HTMLButtonElement | null>(null);
  const reduzir = useMovimentoReduzido();
  const aberta = indice !== null;
  const atual = indice === null ? null : midias[indice];

  useEffect(() => {
    if (!aberta) return;
    const modal = dialogo.current;
    const overflow = document.documentElement.style.overflow;
    modal?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => {
      modal?.close();
      document.documentElement.style.overflow = overflow;
      origem.current?.focus();
    };
  }, [aberta]);

  function navegar(direcao: number) {
    setIndice((i) => i === null ? null : (i + direcao + midias.length) % midias.length);
  }

  if (!midias.length) return null;
  return <section aria-labelledby="galeria-titulo" className="mt-16">
    <h2 id="galeria-titulo" className="text-3xl font-semibold tracking-tight">Veja de perto</h2>
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{midias.map((midia, i) => <li key={midia.id}>
      <button type="button" onClick={(e) => { origem.current = e.currentTarget; setIndice(i); }} aria-label={`Abrir ${midia.tipo === "video" ? "vídeo" : "foto"} ${i + 1}: ${midia.legenda ?? titulo}`} className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-brand-dark/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
        {midia.tipo === "foto" ? <Image src={midia.url} alt={midia.legenda ?? `Foto do projeto ${titulo}`} fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:group-hover:transform-none" /> : <><video src={midia.url} muted playsInline preload="metadata" aria-hidden="true" className="size-full object-cover" /><span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/20"><Play className="size-12 rounded-full bg-brand-dark p-3 text-white" /></span></>}
      </button>
    </li>)}</ul>
    <dialog ref={dialogo} aria-labelledby="midia-titulo" onCancel={() => setIndice(null)} onClose={() => setIndice(null)} onClick={(e) => { if (e.target === e.currentTarget) setIndice(null); }} onKeyDown={(e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); navegar(e.key === "ArrowLeft" ? -1 : 1); }
    }} className="fixed inset-0 m-auto max-h-[95svh] w-[calc(100%_-_1rem)] max-w-6xl overflow-y-auto rounded-2xl border border-white/20 bg-brand-dark p-4 text-white backdrop:bg-black/85 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4"><p id="midia-titulo" className="min-w-0 break-words text-sm">{titulo}</p><button type="button" autoFocus onClick={() => setIndice(null)} aria-label="Fechar galeria" className={CONTROLE}><X aria-hidden="true" /></button></div>
      <AnimatePresence mode="wait" initial={false}>{atual && <motion.figure key={atual.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduzir ? 0 : 0.2 }}>
        {atual.tipo === "foto" ? <div className="relative h-[55svh] sm:h-[65svh]"><Image src={atual.url} alt={atual.legenda ?? `Foto do projeto ${titulo}`} fill sizes="(min-width: 1280px) 1152px, 95vw" className="object-contain" /></div> : <video src={atual.url} muted controls playsInline preload="metadata" aria-label={atual.legenda ?? `Vídeo do projeto ${titulo}`} className="mx-auto max-h-[65svh] w-full" />}
        {atual.legenda && <figcaption className="mt-4 text-center text-sm leading-6 text-white/85">{atual.legenda}</figcaption>}
      </motion.figure>}</AnimatePresence>
      <div className="mt-5 flex items-center justify-center gap-5"><button type="button" aria-label="Mídia anterior" onClick={() => navegar(-1)} className={CONTROLE}><ChevronLeft aria-hidden="true" /></button><p aria-live="polite" aria-atomic="true" className="text-sm tabular-nums">{indice === null ? 0 : indice + 1} / {midias.length}</p><button type="button" aria-label="Próxima mídia" onClick={() => navegar(1)} className={CONTROLE}><ChevronRight aria-hidden="true" /></button></div>
    </dialog>
  </section>;
}
