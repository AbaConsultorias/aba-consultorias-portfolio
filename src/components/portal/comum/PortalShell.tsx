import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import "@/components/publico/publico.css";
import "./portal.css";

export type AreaPortal = "cliente" | "empreiteiro" | "fornecedor";
export type PortalShellProps = { nome: string; area?: AreaPortal; children: ReactNode };

export function PortalShell({ nome, area = "cliente", children }: PortalShellProps) {
  return (
    <div className="nova portal">
      <a className="portal-pular" href="#conteudo-portal">Pular para o conteúdo</a>
      <header className="portal-cabecalho">
        <div className="portal-container portal-barra">
          <Link href={`/${area}`} className="portal-marca" prefetch={false}>
            <Image src="/marca/aba-logo.png" alt="ABA Consultorias" width={36} height={44} priority />
            <span>Portal do {area}</span>
          </Link>
          <div className="portal-conta">
            <span className="portal-nome">{nome}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="conteudo-portal" className="portal-container portal-conteudo" tabIndex={-1}>{children}</main>
      <footer className="portal-container portal-rodape">
        <span>ABA Consultorias · Acompanhamento do seu empreendimento</span>
        <Link href="/contato" prefetch={false}>Fale com a equipe</Link>
      </footer>
    </div>
  );
}
