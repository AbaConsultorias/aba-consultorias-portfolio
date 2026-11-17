"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { ChartNoAxesCombined, FolderKanban, HardHat, Files, Wallet, CalendarRange } from "lucide-react";
import type { UUID } from "@/lib/portal/comum/tipos";

const ABAS = [
  { segmento: null, nome: "Andamento", Icone: ChartNoAxesCombined },
  { segmento: "projetos", nome: "Projetos", Icone: FolderKanban },
  { segmento: "obras", nome: "Obras", Icone: HardHat },
  { segmento: "documentos", nome: "Documentos", Icone: Files },
  { segmento: "financeiro", nome: "Financeiro", Icone: Wallet },
  { segmento: "cronograma", nome: "Cronograma", Icone: CalendarRange },
] as const;

export function NavegacaoEmpreendimento({ empreendimentoId }: { empreendimentoId: UUID }) {
  const segmentoAtual = useSelectedLayoutSegment();
  const base = `/cliente/empreendimentos/${empreendimentoId}`;
  return (
    <nav aria-label="Seções do empreendimento" className="portal-abas">
      {ABAS.map(({ segmento, nome, Icone }) => (
        <Link key={nome} href={segmento ? `${base}/${segmento}` : base} prefetch={false}
          aria-current={segmentoAtual === segmento ? "page" : undefined}>
          <Icone size={18} aria-hidden="true" />{nome}
        </Link>
      ))}
    </nav>
  );
}
