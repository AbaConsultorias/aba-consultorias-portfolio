import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaShell } from "@/components/area/AreaShell";
import { GestorEquipe } from "@/components/admin/equipe/GestorEquipe";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { METADATA_INTERNA } from "@/lib/auth/metadata-interna";
import { listar } from "@/lib/portal/comum/contas-internas";

export const dynamic = "force-dynamic";

// O guard roda antes de devolver qualquer metadata: sem acesso, o 404 sai sem título próprio.
export async function generateMetadata(): Promise<Metadata> {
  await exigirRegraPagina("so-admin");
  return { ...METADATA_INTERNA, title: "Equipe" };
}

export default async function EquipePage() {
  const { perfil } = await exigirRegraPagina("so-admin");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  const contas = await listar();

  return (
    <AreaShell titulo="Equipe" nome={perfil.nome} redirecionarAposSair={`/${adminPath}/entrar`}>
      <Link
        href={`/${adminPath}`}
        prefetch={false}
        className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Voltar ao painel interno
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Equipe</h1>
      <div className="mt-6">
        <GestorEquipe adminPath={adminPath} contas={contas} />
      </div>
    </AreaShell>
  );
}
