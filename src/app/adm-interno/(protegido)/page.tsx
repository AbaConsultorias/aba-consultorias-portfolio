import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaShell } from "@/components/area/AreaShell";
import { temAcessoAoPortal } from "@/components/admin/portal/comum/acesso-portal";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirContaInterna } from "@/lib/auth/permissoes-servidor";

export default async function AdminPage() {
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  const { perfil, permissoes } = await exigirContaInterna();
  const ehAdmin = perfil.papel === "admin";
  const veConteudo = permissoes.has("site.ver") || permissoes.has("contatos.ver");
  const vePortal = temAcessoAoPortal(permissoes);

  return (
    <AreaShell
      titulo="Painel interno"
      nome={perfil.nome}
      redirecionarAposSair={`/${adminPath}/entrar`}
    >
      <h1 className="text-xl font-semibold">Painel interno</h1>
      <p className="mt-2 text-muted-foreground">Olá, {perfil.nome}.</p>
      {!vePortal && !veConteudo && !ehAdmin && (
        <p className="mt-6 text-muted-foreground">Sua conta ainda não tem áreas liberadas. Fale com o administrador.</p>
      )}
      {vePortal && (
        <Link
          href={`/${adminPath}/portal`}
          prefetch={false}
          className="mr-4 mt-6 inline-flex rounded-lg border border-border bg-primary px-4 py-3 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Gerenciar o portal do cliente
        </Link>
      )}
      {veConteudo && (
        <Link
          href={`/${adminPath}/conteudo`}
          prefetch={false}
          className="mt-6 inline-flex rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Gerenciar o conteúdo do site
        </Link>
      )}
      {ehAdmin && (
        <Link
          href={`/${adminPath}/equipe`}
          prefetch={false}
          className="ml-4 mt-6 inline-flex rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Gerenciar a equipe
        </Link>
      )}
    </AreaShell>
  );
}
