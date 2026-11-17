"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSvgLimpo } from "@/components/admin/comum/PreviaSvg";
import type { StatusLote } from "@/lib/conteudo/tipos";
import { ORDEM_STATUS, ROTULO_STATUS, COR_NO_MAPA } from "./status";
import type { LoteAdmin } from "./consultas";

type Props = {
  mapaUrl: string;
  lotes: LoteAdmin[];
  aoClicar: (lote: LoteAdmin) => void;
};

const ESTILO = `
.mapa-admin [data-lote] { cursor: pointer; transition: opacity 0.2s ease; }
.mapa-admin [data-lote]:hover { opacity: 0.75; }
.mapa-admin [data-lote]:focus-visible { outline: 3px solid #1c2832; outline-offset: 2px; }
${ORDEM_STATUS.map(
  (status: StatusLote) =>
    `.mapa-admin [data-status="${status}"], .mapa-admin [data-status="${status}"] :is(path, rect, polygon, polyline, circle, ellipse) { fill: ${COR_NO_MAPA[status]} !important; }`,
).join("\n")}
@media (prefers-reduced-motion: reduce) { .mapa-admin [data-lote] { transition: none; } }
`;

function idsDoDesenho(svg: string) {
  return new Set(Array.from(svg.matchAll(/\sid="([^"]+)"/g), (achado) => achado[1]));
}

// Mapa já sanitizado em que cada forma com id igual ao “código no mapa” de um
// lote vira um botão pintado com a cor do status.
export function MapaInterativo({ mapaUrl, lotes, aoClicar }: Props) {
  const { carregando, svg } = useSvgLimpo(mapaUrl);
  const raiz = useRef<HTMLDivElement>(null);
  const porSvgId = useMemo(() => {
    const mapa = new Map<string, LoteAdmin>();
    for (const lote of lotes) if (lote.svgId) mapa.set(lote.svgId, lote);
    return mapa;
  }, [lotes]);

  useEffect(() => {
    if (!raiz.current || !svg) return;

    for (const elemento of raiz.current.querySelectorAll("[id]")) {
      const lote = porSvgId.get(elemento.id);
      if (!lote) {
        for (const atributo of ["data-lote", "data-status", "tabindex", "role", "aria-label"]) {
          elemento.removeAttribute(atributo);
        }
        continue;
      }
      elemento.setAttribute("data-lote", lote.id);
      elemento.setAttribute("data-status", lote.status);
      elemento.setAttribute("tabindex", "0");
      elemento.setAttribute("role", "button");
      elemento.setAttribute(
        "aria-label",
        `Quadra ${lote.quadra}, lote ${lote.numero}: ${ROTULO_STATUS[lote.status]}`,
      );
    }
  }, [svg, porSvgId]);

  const semForma = useMemo(() => {
    if (!svg) return [];
    const ids = idsDoDesenho(svg);
    return lotes.filter((lote) => lote.svgId && !ids.has(lote.svgId));
  }, [svg, lotes]);

  function lotePeloAlvo(alvo: EventTarget) {
    const id = (alvo as Element).closest?.("[data-lote]")?.getAttribute("data-lote");
    return lotes.find((lote) => lote.id === id);
  }

  if (carregando) return <p className="text-sm text-muted-foreground">Carregando mapa...</p>;
  if (!svg) return <p className="text-sm text-destructive">Não foi possível exibir o mapa enviado.</p>;

  return (
    <div className="flex flex-col gap-2">
      <style>{ESTILO}</style>
      <div
        ref={raiz}
        className="mapa-admin max-h-[32rem] overflow-auto rounded-lg border border-border bg-muted p-2 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        onClick={(evento) => {
          const lote = lotePeloAlvo(evento.target);
          if (lote) aoClicar(lote);
        }}
        onKeyDown={(evento) => {
          if (evento.key !== "Enter" && evento.key !== " ") return;
          const lote = lotePeloAlvo(evento.target);
          if (!lote) return;
          evento.preventDefault();
          aoClicar(lote);
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legenda do mapa">
        {ORDEM_STATUS.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 rounded-sm"
              style={{ backgroundColor: COR_NO_MAPA[status] }}
            />
            {ROTULO_STATUS[status]}
          </li>
        ))}
      </ul>
      {semForma.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {semForma.length} {semForma.length === 1 ? "lote tem um código" : "lotes têm código"} que não existe neste
          mapa (ex.: {semForma[0].svgId}). Confira o código no cadastro do lote.
        </p>
      )}
    </div>
  );
}
