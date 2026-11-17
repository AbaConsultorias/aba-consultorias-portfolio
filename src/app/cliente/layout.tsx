import { exigirPapel } from "@/lib/auth/guard";
import type { Metadata } from "next";
import { PortalShell } from "@/components/portal/comum/PortalShell";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  return { title: "Portal do cliente", robots: { index: false, follow: false } };
}

export default async function ClienteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { perfil } = await exigirPapel(["cliente"], { semAcesso: "entrar" });

  return <PortalShell nome={perfil.nome}>{children}</PortalShell>;
}
