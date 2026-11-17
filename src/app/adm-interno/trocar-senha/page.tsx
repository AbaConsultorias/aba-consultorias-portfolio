import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { TrocarSenhaForm } from "@/components/auth/TrocarSenhaForm";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirPapel } from "@/lib/auth/guard";
import { METADATA_INTERNA } from "@/lib/auth/metadata-interna";
import { PAPEIS_STAFF } from "@/lib/auth/papeis";

const OPCOES_DO_GUARD = { semAcesso: "404", permitirTrocaSenhaPendente: true } as const;

export async function generateMetadata(): Promise<Metadata> {
  if (!obterAdminPath()) notFound();
  await exigirPapel(PAPEIS_STAFF, OPCOES_DO_GUARD);
  return METADATA_INTERNA;
}

export default async function AdminTrocarSenhaPage() {
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  await exigirPapel(PAPEIS_STAFF, OPCOES_DO_GUARD);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <TrocarSenhaForm />
      <LogoutButton redirecionarPara={`/${adminPath}/entrar`} />
    </main>
  );
}
