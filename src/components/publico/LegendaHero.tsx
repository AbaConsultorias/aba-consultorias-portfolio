"use client";

import type { BannerHero } from "@/lib/conteudo/tipos";

import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { DURACAO_SLIDE_MS, useSlidesHero } from "./SlidesHero";

export function LegendaHero({ banners }: { banners: BannerHero[] }) {
  const { atual, ir } = useSlidesHero();
  const tema = banners[atual % banners.length];
  if (!tema) return null;

  return (
    <div className="flex shrink-0 items-center gap-5 tracking-[0.14em] text-white/80 normal-case">
      <p className="relative flex items-center gap-2 overflow-hidden">
        {tema.legenda && <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-(--nova-acento-claro)" />}
        <span key={tema.id} className="nova-legenda-troca block whitespace-nowrap">
          {tema.legenda}
        </span>
      </p>
      <div className="hidden items-center gap-2 sm:flex">
        {banners.map((item, indice) => (
          <button
            key={item.id}
            type="button"
            onClick={() => ir(indice)}
            aria-label={`Mostrar: ${item.sobrancelha}`}
            aria-current={indice === atual || undefined}
            className={cn(
              "relative h-1 overflow-hidden rounded-full bg-white/25 transition-[width,background-color] duration-500 hover:bg-white/45 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
              indice === atual ? "w-14" : "w-6",
            )}
          >
            {indice === atual && (
              <span
                key={atual}
                style={{ animationDuration: `${DURACAO_SLIDE_MS}ms` }}
                className="nova-progresso-slide absolute inset-y-0 left-0 w-full origin-left rounded-full bg-(--nova-acento-claro)"
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
