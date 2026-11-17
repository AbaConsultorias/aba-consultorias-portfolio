"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { projetoDoHash } from "@/lib/portal/documentos/regras";

type Props = {
  projetoId: string | null;
  nome: string;
  quantidade: number;
  nivel?: number;
  dependeDe?: string | null;
  liberados?: number;
  // Só a página de um projeto no admin pede o cartão já aberto; nas listas ele continua fechado.
  abertoAoCarregar?: boolean;
  children: ReactNode;
};

// Todo cartão nasce fechado; só a âncora #projeto-<id> abre o cartão correspondente.
export function CartaoProjetoDocumentos({ projetoId, nome, quantidade, nivel = 0, dependeDe = null, liberados, abertoAoCarregar = false, children }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);
  const id = projetoId ? `projeto-${projetoId}` : "documentos-gerais";

  useEffect(() => {
    if (abertoAoCarregar && ref.current) ref.current.open = true;
  }, [abertoAoCarregar]);

  useEffect(() => {
    function abrirAncora() {
      const corresponde = projetoId ? projetoDoHash(window.location.hash) === projetoId : window.location.hash === `#${id}`;
      if (!corresponde || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start", behavior: "instant" });
    }
    abrirAncora();
    window.addEventListener("hashchange", abrirAncora);
    return () => window.removeEventListener("hashchange", abrirAncora);
  }, [id, projetoId]);

  return (
    <details ref={ref} id={id} className={`portal-docs-projeto${nivel > 0 ? " portal-docs-dependente" : ""}`} data-nivel={Math.min(nivel, 3)}>
      <summary className="portal-docs-resumo">
        <span className="portal-docs-cabecalho">
          <span className="portal-docs-nome" role="heading" aria-level={2}>{nome}</span>
          {dependeDe && <span className="portal-docs-depende">Depende de {dependeDe}</span>}
          <span className="portal-docs-contagem">{quantidade} {quantidade === 1 ? "documento" : "documentos"}</span>
          {liberados !== undefined && <span className="portal-docs-visibilidade">{liberados} {liberados === 1 ? "liberado" : "liberados"} · {quantidade - liberados} {quantidade - liberados === 1 ? "oculto" : "ocultos"}</span>}
        </span>
        <ChevronDown className="portal-docs-chevron" size={20} aria-hidden="true" />
      </summary>
      <div className="portal-docs-conteudo">{children}</div>
    </details>
  );
}
