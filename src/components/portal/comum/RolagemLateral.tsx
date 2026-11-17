"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoveHorizontal } from "lucide-react";

// Área que rola para o lado (tabelas no celular): mostra um aviso e um degradê
// na borda enquanto ainda há conteúdo escondido. Sem rolagem, nada aparece.
export function RolagemLateral({ className, rotulo, sombraInicio = true, children }: {
  className: string;
  rotulo: string;
  // Desligar quando a primeira coluna é fixa: o degradê cobriria o nome do item.
  sombraInicio?: boolean;
  children: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState({ rola: false, noInicio: true, noFim: true });

  useEffect(() => {
    const elemento = area.current;
    if (!elemento) return;
    const medir = () => {
      const sobra = elemento.scrollWidth - elemento.clientWidth;
      const posicao = Math.abs(elemento.scrollLeft);
      const novo = { rola: sobra > 2, noInicio: posicao <= 2, noFim: posicao >= sobra - 2 };
      setEstado((atual) => (atual.rola === novo.rola && atual.noInicio === novo.noInicio && atual.noFim === novo.noFim ? atual : novo));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    elemento.addEventListener("scroll", medir, { passive: true });
    return () => {
      observador.disconnect();
      elemento.removeEventListener("scroll", medir);
    };
  }, []);

  return (
    <div className="rolagem-lateral">
      {estado.rola && (
        <p className="rolagem-dica" aria-hidden="true">
          <MoveHorizontal size={16} />
          {estado.noFim ? "Deslize de volta para ver o início" : "Deslize para o lado para ver mais"}
        </p>
      )}
      <div className="rolagem-moldura">
        <div ref={area} className={className} role="region" tabIndex={0} aria-label={rotulo}>
          {children}
        </div>
        {sombraInicio && <span className="rolagem-sombra" data-lado="inicio" data-visivel={estado.rola && !estado.noInicio} aria-hidden="true" />}
        <span className="rolagem-sombra" data-lado="fim" data-visivel={estado.rola && !estado.noFim} aria-hidden="true" />
      </div>
    </div>
  );
}
