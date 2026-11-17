import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { NavConteudo } from "@/components/admin/comum/NavConteudo";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";

export default async function ConteudoLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  const { perfil, permissoes } = await exigirRegraPagina({ qualquer: ["site.ver", "contatos.ver"] });

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href={`/${adminPath}/conteudo`}
            className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Image src="/marca/aba-logo.png" alt="" width={32} height={39} priority />
            <span className="truncate text-sm font-semibold text-primary">Conteúdo do site</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{perfil.nome}</span>
            <LogoutButton redirecionarPara={`/${adminPath}/entrar`} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 md:flex-row md:gap-8 md:py-8">
        <NavConteudo adminPath={adminPath} permissoes={[...permissoes]} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
