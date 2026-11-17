import { exigirPapel } from "@/lib/auth/guard";
import { PortalShell } from "@/components/portal/comum/PortalShell";
import { NavegacaoFornecedor } from "@/components/portal/comum/NavegacaoFornecedor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do fornecedor", robots: { index: false, follow: false } };

export default async function FornecedorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { perfil } = await exigirPapel(["fornecedor"], { semAcesso: "entrar" });

  return <PortalShell nome={perfil.nome} area="fornecedor"><NavegacaoFornecedor />{children}</PortalShell>;
}
