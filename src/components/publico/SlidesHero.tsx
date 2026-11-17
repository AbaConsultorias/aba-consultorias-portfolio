"use client";

import type { BannerHero } from "@/lib/conteudo/tipos";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMovimentoReduzido } from "./ganchos";

export const DURACAO_SLIDE_MS = 5500;
// O texto sai um pouco antes da foto trocar, para a troca parecer uma só.
const SAIDA_TEXTO_MS = 550;

type Slides = { atual: number; total: number; tema: BannerHero; saindo: boolean; jaTrocou: boolean; ir: (indice: number) => void };

const ContextoSlides = createContext<Slides | null>(null);

export function useSlidesHero() {
  const slides = useContext(ContextoSlides);
  if (!slides) throw new Error("useSlidesHero precisa estar dentro de SlidesHero");
  return slides;
}

export function SlidesHero({ children, banners }: { children: ReactNode; banners: BannerHero[] }) {
  const [atual, setAtual] = useState(0);
  const [destino, setDestino] = useState<number | null>(null);
  const [jaTrocou, setJaTrocou] = useState(false);
  const reduzir = useMovimentoReduzido();
  const total = banners.length;

  useEffect(() => {
    if (reduzir || destino !== null || total < 2) return;
    const temporizador = window.setTimeout(() => setDestino((atual + 1) % total), DURACAO_SLIDE_MS);
    return () => window.clearTimeout(temporizador);
  }, [atual, destino, reduzir, total]);

  useEffect(() => {
    if (destino === null) return;
    const temporizador = window.setTimeout(() => {
      setAtual(destino);
      setJaTrocou(true);
      setDestino(null);
    }, SAIDA_TEXTO_MS);
    return () => window.clearTimeout(temporizador);
  }, [destino]);

  function ir(indice: number) {
    if (indice === atual || destino !== null) return;
    setDestino(indice);
  }

  if (!total) return null;

  return (
    <ContextoSlides.Provider value={{ atual, total, tema: banners[atual % total], saindo: destino !== null, jaTrocou, ir }}>
      {children}
    </ContextoSlides.Provider>
  );
}
