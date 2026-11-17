"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { LayoutDashboard, Building2, Users, ListChecks, Newspaper, Files, Wallet, ArrowLeft, HardHat, ClipboardCheck, Truck, CalendarRange, FileCheck, HandCoins, Inbox, Server } from "lucide-react";
import type { Permissao } from "@/lib/auth/permissoes";
import { PERMISSAO_POR_SEGMENTO } from "./acesso-portal";

const ITENS = [
  { segmento: null, nome: "Visão geral", Icone: LayoutDashboard },
  { segmento: "empreendimentos", nome: "Empreendimentos", Icone: Building2 },
  { segmento: "clientes", nome: "Clientes", Icone: Users },
  { segmento: "modelos", nome: "Modelos", Icone: ListChecks },
  { segmento: "atualizacoes", nome: "Atualizações", Icone: Newspaper },
  { segmento: "documentos", nome: "Documentos", Icone: Files },
  { segmento: "chegaram", nome: "Chegaram do servidor", Icone: Inbox },
  { segmento: "servidor", nome: "Servidor", Icone: Server },
  { segmento: "financeiro", nome: "Financeiro", Icone: Wallet },
  { segmento: "a-cobrar", nome: "A cobrar", Icone: HandCoins },
  { segmento: "obras", nome: "Obras", Icone: HardHat },
  { segmento: "relatos", nome: "Relatos", Icone: ClipboardCheck },
  { segmento: "empreiteiros", nome: "Empreiteiros", Icone: Users },
  { segmento: "fornecedores", nome: "Fornecedores", Icone: Truck },
  { segmento: "fornecedor-documentos", nome: "Documentos de fornecedores", Icone: FileCheck },
  { segmento: "cronograma", nome: "Cronograma", Icone: CalendarRange },
] as const;

// Conforto de navegação: a barreira de acesso está na rota e na página.
export function NavPortal({ adminPath, permissoes }: { adminPath: string; permissoes: readonly Permissao[] }) {
  const segmentoAtual = useSelectedLayoutSegment();
  const base = `/${adminPath}/portal`;
  const itens = ITENS.filter(({ segmento }) => segmento === null || permissoes.includes(PERMISSAO_POR_SEGMENTO[segmento]));
  return (
    <nav aria-label="Administração do portal" className="portal-nav">
      <ul>
        {itens.map(({ segmento, nome, Icone }) => (
          <li key={nome}>
            <Link href={segmento ? `${base}/${segmento}` : base} prefetch={false}
              aria-current={segmentoAtual === segmento || (segmento === "empreendimentos" && segmentoAtual === "projetos") ? "page" : undefined}>
              <Icone size={18} aria-hidden="true" />{nome}
            </Link>
          </li>
        ))}
        <li><Link href={`/${adminPath}`} prefetch={false}><ArrowLeft size={18} aria-hidden="true" />Painel interno</Link></li>
      </ul>
    </nav>
  );
}
