import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { NavPortal } from "@/components/admin/portal/comum/NavPortal";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirContaInterna } from "@/lib/auth/permissoes-servidor";
import { temAcessoAoPortal } from "@/components/admin/portal/comum/acesso-portal";
import "@/components/publico/publico.css";
import "@/components/portal/comum/portal.css";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const { perfil, permissoes } = await exigirContaInterna();
  const adminPath = obterAdminPath();
  if (!adminPath || !temAcessoAoPortal(permissoes)) notFound();
  return (
    <div className="nova portal">
      <a className="portal-pular" href="#conteudo-admin-portal">Pular para o conteúdo</a>
      <header className="portal-cabecalho">
        <div className="portal-container portal-barra">
          <Link href={`/${adminPath}/portal`} className="portal-marca" prefetch={false}>
            <Image src="/marca/aba-logo.png" alt="ABA Consultorias" width={36} height={44} priority />
            <span>Gestão do portal</span>
          </Link>
          <div className="portal-conta"><span className="portal-nome">{perfil.nome}</span><LogoutButton redirecionarPara={`/${adminPath}/entrar`} /></div>
        </div>
      </header>
      <div className="portal-container portal-conteudo portal-admin-corpo">
        <NavPortal adminPath={adminPath} permissoes={[...permissoes]} />
        <main id="conteudo-admin-portal" className="min-w-0" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
