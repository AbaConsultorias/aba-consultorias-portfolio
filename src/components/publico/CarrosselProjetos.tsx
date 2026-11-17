"use client";

import type { ProjetoResumo } from "@/lib/conteudo/tipos";

import { useCallback, useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useScroll, useSpring } from "motion/react";
import { ArrowLeft, ArrowRight, ArrowUpRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

import { useMovimentoReduzido } from "./ganchos";

const EASE = [0.33, 1, 0.68, 1] as const;

const LIMIAR_ARRASTE = 6;

function doisDigitos(valor: number) {
  return String(valor).padStart(2, "0");
}

type Arraste = { inicioX: number; inicioScroll: number; moveu: boolean };

export function CarrosselProjetos({ projetos }: { projetos: ProjetoResumo[] }) {
  const total = projetos.length;
  const trilha = useRef<HTMLUListElement>(null);
  const arraste = useRef<Arraste | null>(null);
  const bloquearClique = useRef(false);
  const [ativo, setAtivo] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const reduzir = useMovimentoReduzido();
  const { scrollXProgress } = useScroll({ container: trilha });
  const progresso = useSpring(scrollXProgress, { stiffness: 160, damping: 30, restDelta: 0.001 });

  const cartoes = useCallback(() => Array.from(trilha.current?.children ?? []) as HTMLElement[], []);

  const indiceMaisProximo = useCallback(() => {
    const elemento = trilha.current;
    if (!elemento) return 0;
    const inicio = elemento.getBoundingClientRect().left + parseFloat(getComputedStyle(elemento).paddingLeft);
    let melhor = 0;
    let menorDistancia = Infinity;
    cartoes().forEach((cartao, indice) => {
      const distancia = Math.abs(cartao.getBoundingClientRect().left - inicio);
      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        melhor = indice;
      }
    });
    return melhor;
  }, [cartoes]);

  const irPara = useCallback(
    (indice: number) => {
      const elemento = trilha.current;
      const alvo = cartoes()[Math.max(0, Math.min(total - 1, indice))];
      if (!elemento || !alvo) return;
      const recuo = parseFloat(getComputedStyle(elemento).paddingLeft);
      const destino = elemento.scrollLeft + alvo.getBoundingClientRect().left - elemento.getBoundingClientRect().left - recuo;
      elemento.scrollTo({ left: destino, behavior: reduzir ? "auto" : "smooth" });
    },
    [cartoes, reduzir, total],
  );

  useEffect(() => {
    const elemento = trilha.current;
    if (!elemento) return;
    let quadro = 0;
    const aoRolar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => setAtivo(indiceMaisProximo()));
    };
    elemento.addEventListener("scroll", aoRolar, { passive: true });
    return () => {
      cancelAnimationFrame(quadro);
      elemento.removeEventListener("scroll", aoRolar);
    };
  }, [indiceMaisProximo]);

  function iniciarArraste(evento: EventoPonteiro<HTMLUListElement>) {
    if (evento.pointerType !== "mouse" || evento.button !== 0 || !trilha.current) return;
    arraste.current = { inicioX: evento.clientX, inicioScroll: trilha.current.scrollLeft, moveu: false };
  }

  function moverArraste(evento: EventoPonteiro<HTMLUListElement>) {
    const estado = arraste.current;
    const elemento = trilha.current;
    if (!estado || !elemento) return;
    const delta = evento.clientX - estado.inicioX;
    if (!estado.moveu && Math.abs(delta) < LIMIAR_ARRASTE) return;
    if (!estado.moveu) {
      estado.moveu = true;
      elemento.setPointerCapture(evento.pointerId);
      setArrastando(true);
    }
    elemento.scrollLeft = estado.inicioScroll - delta;
  }

  function terminarArraste() {
    const estado = arraste.current;
    arraste.current = null;
    if (!estado?.moveu) return;
    bloquearClique.current = true;
    setArrastando(false);
    requestAnimationFrame(() => irPara(indiceMaisProximo()));
  }

  if (!total) return null;

  return (
    <div role="region" aria-roledescription="carrossel" aria-label="Projetos realizados">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <p className="text-sm font-semibold tabular-nums text-brand-dark" aria-live="polite" aria-atomic="true">
          <span className="sr-only">Projeto </span>
          <span className="relative inline-flex h-5 w-[2ch] overflow-hidden align-bottom">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={ativo}
                initial={{ y: reduzir ? 0 : "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: reduzir ? 0 : "-100%", opacity: 0 }}
                transition={{ duration: reduzir ? 0 : 0.45, ease: EASE }}
                className="absolute inset-0"
              >
                {doisDigitos(ativo + 1)}
              </motion.span>
            </AnimatePresence>
          </span>
          <span aria-hidden="true" className="px-1.5 text-[#526B78]">/</span>
          <span className="sr-only"> de </span>
          <span className="text-[#526B78]">{doisDigitos(total)}</span>
        </p>
        <div className="flex gap-2">
          {[
            { rotulo: "Projeto anterior", Icone: ArrowLeft, destino: ativo - 1, desabilitado: ativo === 0 },
            { rotulo: "Próximo projeto", Icone: ArrowRight, destino: ativo + 1, desabilitado: ativo === total - 1 },
          ].map(({ rotulo, Icone, destino, desabilitado }) => (
            <button
              key={rotulo}
              type="button"
              aria-label={rotulo}
              aria-controls="carrossel-projetos"
              disabled={desabilitado}
              onClick={() => irPara(destino)}
              className={cn(
                "group grid size-12 place-items-center rounded-full border border-brand-dark/15 text-brand-dark sm:size-14",
                "transition-[background-color,color,border-color,opacity,scale] duration-500 hover:border-brand-dark hover:bg-brand-dark hover:text-white active:scale-95",
                "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento) disabled:pointer-events-none disabled:opacity-35 motion-reduce:active:scale-100",
              )}
            >
              <Icone aria-hidden="true" className="size-5" />
            </button>
          ))}
        </div>
      </div>

      <ul
        ref={trilha}
        id="carrossel-projetos"
        aria-label="Lista de projetos; use as setas do teclado para rolar"
        tabIndex={0}
        onPointerDown={iniciarArraste}
        onPointerMove={moverArraste}
        onPointerUp={terminarArraste}
        onPointerCancel={terminarArraste}
        onClickCapture={(evento) => {
          if (!bloquearClique.current) return;
          bloquearClique.current = false;
          evento.preventDefault();
          evento.stopPropagation();
        }}
        onDragStart={(evento) => evento.preventDefault()}
        className={cn(
          "nova-trilha mt-8 flex gap-4 overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden",
          "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)",
          arrastando ? "cursor-grabbing snap-none select-none" : "cursor-grab snap-x snap-mandatory",
        )}
      >
        {projetos.map((projeto, indice) => {
          const emFoco = indice === ativo;
          return (
            <li
              key={projeto.slug}
              role="group"
              aria-roledescription="slide"
              aria-label={`${indice + 1} de ${total}: ${projeto.titulo}`}
              className="w-(--cartao) shrink-0 snap-start"
            >
              <Link
                href={`/projetos/${projeto.slug}`}
                draggable={false}
                className={cn(
                  "group relative block aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-brand-dark sm:aspect-[16/10] sm:rounded-[2.25rem]",
                  "transition-[opacity,scale] duration-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)",
                  emFoco ? "opacity-100" : "opacity-60 hover:opacity-90 motion-safe:sm:scale-[0.96]",
                )}
              >
                {projeto.capaUrl && <Image
                  src={projeto.capaUrl!}
                  alt={projeto.titulo}
                  fill
                  draggable={false}
                  sizes="(min-width: 1024px) min(54vw, 736px), (min-width: 640px) 64vw, 84vw"
                  className="object-cover transition-[scale] duration-[1200ms] group-hover:scale-[1.06] motion-reduce:group-hover:scale-100"
                />}
                <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-[#16222c]/90 via-[#16222c]/20 to-transparent" />
                <span className="absolute top-4 left-4 rounded-full bg-white/90 px-3.5 py-1.5 text-[11px] font-semibold text-brand-dark backdrop-blur-md sm:top-6 sm:left-6 sm:text-xs">
                  Infraestrutura de água e esgoto
                </span>
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 text-white sm:p-8">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tabular-nums text-white/70">{doisDigitos(indice + 1)}</p>
                    <h3 className="mt-1 text-2xl leading-tight font-semibold tracking-[-0.03em] sm:text-4xl">{projeto.titulo}</h3>
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-white/85">
                      <MapPin aria-hidden="true" className="size-4 shrink-0" />
                      {projeto.cidade}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-brand-dark transition-[rotate,background-color] duration-500 group-hover:rotate-45 group-hover:bg-(--nova-acento-claro) motion-reduce:group-hover:rotate-0 sm:size-14"
                  >
                    <ArrowUpRight className="size-5" />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mx-auto mt-6 max-w-7xl px-5 sm:px-8">
        <div aria-hidden="true" className="h-px w-full overflow-hidden bg-brand-dark/10">
          <motion.div style={{ scaleX: progresso }} className="h-full origin-left bg-brand-dark" />
        </div>
      </div>
    </div>
  );
}
