"use client";

import { useEffect, useMemo, useState } from "react";
import { sanitizarSvg } from "@/lib/svg/sanitizar";

// Baixa o SVG já publicado e o limpa de novo a cada desenho, logo antes de
// injetar: a mesma regra do servidor, sem confiar no que está guardado.
export function useSvgLimpo(url: string | null) {
  const [estado, setEstado] = useState<{ url: string; texto: string | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelado = false;

    fetch(url)
      .then((res) => (res.ok ? res.text() : null))
      .then((texto) => {
        if (!cancelado) setEstado({ url, texto });
      })
      .catch(() => {
        if (!cancelado) setEstado({ url, texto: null });
      });

    return () => {
      cancelado = true;
    };
  }, [url]);

  const texto = estado?.url === url ? estado.texto : null;
  const svg = useMemo(() => (texto === null ? null : sanitizarSvg(texto)), [texto]);

  if (!url) return { carregando: false, svg: null };
  if (estado?.url !== url) return { carregando: true, svg: null };
  return { carregando: false, svg };
}

export function PreviaSvg({ url, rotulo }: { url: string; rotulo: string }) {
  const { carregando, svg } = useSvgLimpo(url);

  if (carregando) return <p className="text-sm text-muted-foreground">Carregando prévia...</p>;
  if (!svg) return <p className="text-sm text-destructive">Não foi possível exibir o mapa.</p>;

  return (
    <div
      role="img"
      aria-label={rotulo}
      className="max-h-72 overflow-hidden rounded-lg border border-border bg-muted p-2 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-64 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
