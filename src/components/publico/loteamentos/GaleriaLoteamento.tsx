"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import type { Midia } from "@/lib/conteudo/tipos";
import { Revelar } from "../Revelar";
import "./mapa.css";

const DURACAO_SAIDA = 250;

function descrever(midia: Midia, nome: string, indice: number) {
  return midia.legenda ?? `${midia.tipo === "video" ? "Vídeo" : "Foto"} ${indice + 1} do loteamento ${nome}`;
}

export function GaleriaLoteamento({ midias, nome }: { midias: Midia[]; nome: string }) {
  const [atual, setAtual] = useState<number | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const origem = useRef<HTMLElement | null>(null);
  const fechando = useRef(false);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (atual !== null && !elemento.open) elemento.showModal();
  }, [atual]);

  const fechar = useCallback(() => {
    const elemento = dialogo.current;
    if (!elemento || fechando.current) return;
    fechando.current = true;
    elemento.setAttribute("data-fechando", "");
    setTimeout(() => {
      elemento.close();
      elemento.removeAttribute("data-fechando");
      fechando.current = false;
      setAtual(null);
      origem.current?.focus();
    }, DURACAO_SAIDA);
  }, []);

  const andar = useCallback(
    (passo: number) => setAtual((indice) => (indice === null ? null : (indice + passo + midias.length) % midias.length)),
    [midias.length],
  );

  useEffect(() => {
    if (atual === null) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "ArrowRight") andar(1);
      if (evento.key === "ArrowLeft") andar(-1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [atual, andar]);

  if (!midias.length) return null;
  const midia = atual === null ? null : midias[atual];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
        {midias.map((item, indice) => (
          <li key={item.id} className="min-w-0">
            <Revelar atraso={(indice % 3) * 100}>
              <button
                type="button"
                onClick={(evento) => {
                  origem.current = evento.currentTarget;
                  setAtual(indice);
                }}
                aria-label={`Ampliar: ${descrever(item, nome, indice)}`}
                className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[1.25rem] bg-brand-dark/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento) sm:rounded-[1.75rem]"
              >
                {item.tipo === "foto" ? (
                  <Image
                    src={item.url}
                    alt=""
                    fill
                    sizes="(max-width: 639px) 46vw, (max-width: 1023px) 46vw, 400px"
                    className="object-cover transition-[scale] duration-[900ms] group-hover:scale-[1.07] motion-reduce:group-hover:scale-100"
                  />
                ) : (
                  <>
                    <video src={`${item.url}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" className="size-full object-cover" />
                    <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-brand-dark/25 transition-[background-color] duration-500 group-hover:bg-brand-dark/40">
                      <span className="grid size-14 place-items-center rounded-full bg-white text-brand-dark">
                        <Play className="size-5 translate-x-0.5" />
                      </span>
                    </span>
                  </>
                )}
              </button>
            </Revelar>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogo}
        aria-label={`Galeria do loteamento ${nome}`}
        onCancel={(evento) => {
          evento.preventDefault();
          fechar();
        }}
        className="galeria-dialogo"
      >
        {midia && atual !== null && (
          <div className="galeria-palco flex h-full flex-col px-3 pt-3 pb-4 sm:px-8 sm:pt-6 sm:pb-6">
            <div className="flex items-center justify-between gap-3">
              <p aria-live="polite" className="text-sm font-semibold tabular-nums text-white/80">
                {atual + 1} de {midias.length}
              </p>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar a galeria"
                className="grid size-12 place-items-center rounded-full bg-white/10 text-white transition-colors duration-300 hover:bg-white hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <div className="relative my-3 min-h-0 flex-1">
              {midia.tipo === "foto" ? (
                <Image key={midia.id} src={midia.url} alt={descrever(midia, nome, atual)} fill sizes="100vw" className="object-contain" />
              ) : (
                <video key={midia.id} src={midia.url} controls playsInline aria-label={descrever(midia, nome, atual)} className="size-full object-contain" />
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => andar(-1)}
                aria-label="Mídia anterior"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors duration-300 hover:bg-white hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>
              <p className="min-w-0 text-center text-sm text-white/85">{midia.legenda}</p>
              <button
                type="button"
                onClick={() => andar(1)}
                aria-label="Próxima mídia"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors duration-300 hover:bg-white hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
