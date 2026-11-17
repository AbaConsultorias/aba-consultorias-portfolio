import type { BannerHero, Configuracoes } from "@/lib/conteudo/tipos";
import type { CSSProperties } from "react";
import { ConteudoHero } from "./ConteudoHero";
import { DISCIPLINAS } from "./dados";
import { HeroFundo } from "./HeroFundo";
import { LegendaHero } from "./LegendaHero";
import { SlidesHero } from "./SlidesHero";
import { SeloGiratorio } from "./SeloGiratorio";

function atraso(ms: number) {
  return { "--atraso": `${ms}ms` } as CSSProperties;
}

function RedeDesenhada() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      className="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-full text-(--nova-acento-claro) opacity-60 lg:w-[62%]"
    >
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path pathLength={1} className="nova-desenho" style={atraso(500)} d="M860 70 C 720 120, 680 210, 580 270 S 430 390, 330 430 S 150 520, -40 560" />
        <path pathLength={1} className="nova-desenho" style={atraso(1300)} d="M580 270 L 650 390 L 790 430" />
        <path pathLength={1} className="nova-desenho" style={atraso(1600)} d="M450 370 L 400 250 L 470 150 L 560 120" />
        <path pathLength={1} className="nova-desenho" style={atraso(1900)} d="M330 430 L 380 540 L 520 600" />
        <path pathLength={1} className="nova-desenho" style={atraso(2100)} d="M650 390 L 600 520" />
      </g>
      <g fill="currentColor">
        {[
          [580, 270, 2200],
          [450, 370, 2350],
          [650, 390, 2500],
          [330, 430, 2650],
          [470, 150, 2800],
        ].map(([cx, cy, ms]) => (
          <g key={`${cx}-${cy}`} className="nova-surgir" style={atraso(ms)}>
            <circle cx={cx} cy={cy} r="11" fillOpacity="0.18" />
            <circle cx={cx} cy={cy} r="4" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Hero({ banners, configuracoes }: { banners: BannerHero[]; configuracoes: Configuracoes }) {
  if (!banners.length) return null;
  return (
    <section aria-labelledby="hero-titulo" className="relative px-2 pt-2 sm:px-3 sm:pt-3">
      <SlidesHero banners={banners}>
        <div className="relative isolate flex min-h-[calc(100svh-1rem)] flex-col overflow-hidden rounded-[1.75rem] bg-brand-dark text-white sm:min-h-[calc(100svh-1.5rem)] sm:rounded-[2.5rem]">
          <HeroFundo banners={banners} />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-[#16222c]/92 via-[#1f2e3a]/70 to-[#1f2e3a]/10" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-linear-to-t from-[#16222c]/90 to-transparent" />
          <RedeDesenhada />
  
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-end px-5 pt-36 pb-8 sm:px-8 sm:pt-40 lg:pb-10">
            <ConteudoHero banners={banners} configuracoes={configuracoes} />
  
            <div className="relative mt-14 pt-6 lg:mt-20 lg:pr-56">
              <span aria-hidden="true" className="nova-crescer absolute inset-x-0 top-0 h-px bg-white/25" style={atraso(1200)} />
              <div className="nova-surgir flex flex-col gap-4 text-[10px] font-semibold tracking-[0.2em] uppercase sm:flex-row sm:items-center sm:justify-between sm:text-[11px]" style={atraso(1400)}>
                <p className="text-white/80">
                  {DISCIPLINAS.map((disciplina, indice) => (
                    <span key={disciplina}>
                      {indice > 0 && <span aria-hidden="true" className="px-2 text-(--nova-acento-claro)">·</span>}
                      {disciplina}
                    </span>
                  ))}
                </p>
                <LegendaHero banners={banners} />
              </div>
            </div>
          </div>
        </div>
  
        <div className="nova-surgir absolute right-24 bottom-0 z-10 hidden translate-y-1/2 lg:block xl:right-28" style={atraso(1600)}>
          <SeloGiratorio id="selo-hero" />
        </div>
      </SlidesHero>
    </section>
  );
}
