"use client";

import type { VideoInstagram, Configuracoes } from "@/lib/conteudo/tipos";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMovimentoReduzido } from "./ganchos";
import { IconeInstagram } from "./Icones";

export function Reel({ video: midia, numero, total, configuracoes }: { video: VideoInstagram; numero: number; total: number; configuracoes: Configuracoes }) {
  const video = useRef<HTMLVideoElement>(null);
  const [tocando, setTocando] = useState(false);
  const pausadoPeloUsuario = useRef(false);
  const reduzir = useMovimentoReduzido();

  function tocar() {
    const elemento = video.current;
    if (!elemento) return;
    pausadoPeloUsuario.current = false;
    elemento.muted = true;
    void elemento.play().catch(() => setTocando(false));
  }

  function pausar() {
    pausadoPeloUsuario.current = true;
    video.current?.pause();
  }

  useEffect(() => {
    const elemento = video.current;
    if (!elemento || reduzir) return;
    // Toca sozinho enquanto está na tela; fora dela pausa para não gastar dados nem bateria.
    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) {
          if (pausadoPeloUsuario.current) return;
          elemento.muted = true;
          void elemento.play().catch(() => undefined);
          return;
        }
        elemento.pause();
      },
      { threshold: 0.35 },
    );
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [reduzir]);

  return (
    <div
      className={cn(
        "group relative rounded-[2rem] bg-linear-to-br from-(--nova-acento-claro) via-brand to-brand-dark p-[2px]",
        "transition-[translate,box-shadow] duration-500 hover:-translate-y-2 hover:shadow-[0_30px_60px_-28px_rgba(28,40,50,0.65)] motion-reduce:hover:translate-y-0",
      )}
    >
      <div className="relative aspect-[9/16] overflow-hidden rounded-[calc(2rem-2px)] bg-[#16222c]">
        <video
          ref={video}
          poster={midia.posterUrl ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          aria-label={midia.legenda ?? `Vídeo ${numero} de ${total} da ABA no Instagram, sem som`}
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          className="absolute inset-0 size-full object-cover transition-[scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
        >
          <source src={midia.videoUrl} type="video/mp4" />
        </video>

        <span aria-hidden="true" className="absolute top-2.5 left-1/2 h-5 w-16 -translate-x-1/2 rounded-full bg-black/80" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/60 to-transparent" />

        <button
          type="button"
          onClick={() => (tocando ? pausar() : tocar())}
          aria-label={tocando ? `Pausar vídeo ${numero}` : `Reproduzir vídeo ${numero}, sem som`}
          className="absolute inset-0 grid place-items-center rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
        >
          <span
            className={cn(
              "grid size-14 place-items-center rounded-full bg-white/90 text-brand-dark shadow-lg backdrop-blur-md transition-[opacity,scale] duration-500",
              tocando ? "scale-75 opacity-0 group-focus-within:opacity-100 motion-reduce:scale-100" : "scale-100 opacity-100",
            )}
          >
            {tocando ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5 translate-x-px" />}
          </span>
        </button>

        <p className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-1.5 text-xs font-semibold text-white">
          <IconeInstagram className="size-4" />
          {configuracoes.instagramUsuario ? `@${configuracoes.instagramUsuario.replace(/^@/, "")}` : "Instagram"}
        </p>
      </div>
    </div>
  );
}
