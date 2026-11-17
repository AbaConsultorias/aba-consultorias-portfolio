"use client";

import type { BannerHero } from "@/lib/conteudo/tipos";

import { useRef } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useMovimentoReduzido } from "./ganchos";
import { useSlidesHero } from "./SlidesHero";

export function HeroFundo({ banners }: { banners: BannerHero[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduzir = useMovimentoReduzido();
  const { atual, total } = useSlidesHero();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", reduzir ? "0%" : "22%"]);
  const anterior = (atual - 1 + total) % total;
  const proxima = (atual + 1) % total;

  return (
    <div ref={ref} className="absolute inset-0 -z-20 overflow-hidden">
      <motion.div style={{ y }} className="absolute inset-0">
        {banners.map(({ id, imagemUrl, imagemPosicao, legenda, titulo }, indice) => {
          // Só monta a foto que sai, a que está na tela e a próxima (já baixando por trás).
          if (indice !== atual && indice !== anterior && indice !== proxima) return null;
          const visivel = indice === atual;
          return (
            <div
              key={id}
              aria-hidden={!visivel || undefined}
              className={cn(
                "absolute inset-0 transition-opacity duration-[1600ms] ease-in-out",
                visivel ? "z-10 opacity-100" : "opacity-0",
              )}
            >
              <div className={cn("absolute inset-0", (visivel || indice === anterior) && "nova-ken-burns-slide")}>
                <Image
                  src={imagemUrl}
                  alt={visivel ? (legenda ?? titulo) : ""}
                  fill
                  preload={indice === 0}
                  sizes="100vw"
                  className="object-cover"
                  style={{ objectPosition: imagemPosicao }}
                />
              </div>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
