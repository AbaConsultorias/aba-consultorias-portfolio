"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Files, FileSignature, Wallet } from "lucide-react";

const ABAS = [
  { segmento: null, nome: "Parcelas", Icone: Wallet },
  { segmento: "contratos", nome: "Contratos", Icone: FileSignature },
  { segmento: "documentos", nome: "Documentos", Icone: Files },
] as const;

export function NavegacaoFornecedor() {
  const segmentoAtual = useSelectedLayoutSegment();
  return (
    <nav aria-label="Seções do fornecedor" className="portal-abas">
      {ABAS.map(({ segmento, nome, Icone }) => (
        <Link key={nome} href={segmento ? `/fornecedor/${segmento}` : "/fornecedor"} prefetch={false}
          aria-current={segmentoAtual === segmento ? "page" : undefined}>
          <Icone size={18} aria-hidden="true" />{nome}
        </Link>
      ))}
    </nav>
  );
}
