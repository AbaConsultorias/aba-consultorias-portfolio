"use client";

import type { BannerHero, Configuracoes } from "@/lib/conteudo/tipos";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Botao } from "./Botao";
import { linkWhatsApp } from "./dados";
import { useSlidesHero } from "./SlidesHero";
import { TextoMascarado } from "./Titulo";

export function ConteudoHero({ banners, configuracoes }: { banners: BannerHero[]; configuracoes: Configuracoes }) {
  const { atual, saindo, jaTrocou } = useSlidesHero();
  const tema = banners[atual % banners.length];

  // Na abertura da página o texto espera o fundo e o cabeçalho; nas trocas ele entra logo.
  const base = jaTrocou ? 0.45 : 1;
  const atraso = (ms: number) => ({ "--atraso": `${Math.round(ms * base)}ms` }) as CSSProperties;

  if (!tema) return null;

  return (
    <div
      key={tema.id}
      className={cn(
        "transition-[opacity,translate] duration-500 ease-in",
        saindo && "-translate-y-4 opacity-0 motion-reduce:translate-y-0",
      )}
    >
      <p className="nova-surgir flex items-center gap-3 text-[10px] font-semibold tracking-[0.22em] text-white/85 uppercase sm:text-xs" style={atraso(100)}>
        <span aria-hidden="true" className="nova-crescer h-px w-10 bg-(--nova-acento-claro)" style={atraso(200)} />
        ABA Consultoria — {tema.sobrancelha}
      </p>

      <h1 id="hero-titulo" className="nova-entrada mt-6 max-w-5xl text-[2.7rem] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-7xl lg:text-[6.2rem] lg:leading-[0.98]" style={atraso(250)}>
        <TextoMascarado tomAcento="claro" partes={[tema.titulo, ...(tema.tituloDestaque ? [{ acento: tema.tituloDestaque }] : [])]} />
      </h1>

      <p className="nova-surgir mt-7 max-w-xl text-base leading-7 text-white/85 sm:text-lg sm:leading-8" style={atraso(900)}>
        {tema.texto}
      </p>

      <div className="nova-surgir mt-9 flex flex-col gap-3 sm:flex-row sm:items-center" style={atraso(1100)}>
        <Botao href={linkWhatsApp(tema.mensagemWhatsApp, configuracoes.whatsapp)} externo variante="claro" icone="whatsapp">
          Fale pelo WhatsApp
        </Botao>
        {tema.botaoHref && tema.botaoRotulo && (
          <Botao href={tema.botaoHref} variante="contorno-claro">
            {tema.botaoRotulo}
          </Botao>
        )}
      </div>
    </div>
  );
}
