import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LoteamentoForm } from "@/components/admin/loteamentos/LoteamentoForm";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";

export const metadata: Metadata = { title: "Novo loteamento" };

export default async function NovoLoteamentoPage() {
  await exigirRegraPagina("site.editar");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <Link
          href={`/${adminPath}/conteudo/loteamentos`}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Voltar para os loteamentos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Novo loteamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Primeiro os dados básicos. Depois de criar, você envia as fotos, o mapa e cadastra os lotes.
        </p>
      </div>
      <LoteamentoForm adminPath={adminPath} />
    </div>
  );
}
