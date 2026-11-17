import { exigirPapel } from "@/lib/auth/guard";
import { PortalShell } from "@/components/portal/comum/PortalShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do empreiteiro", robots: { index: false, follow: false } };

export default async function EmpreiteiroLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { perfil } = await exigirPapel(["empreiteiro"], { semAcesso: "entrar" });

  return <PortalShell nome={perfil.nome} area="empreiteiro">{children}</PortalShell>;
}
