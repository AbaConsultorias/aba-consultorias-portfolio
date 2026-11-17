import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { listarLoteamentosAdmin } from "@/components/admin/loteamentos/consultas";
import { ListaLoteamentos } from "@/components/admin/loteamentos/ListaLoteamentos";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";

export const metadata: Metadata = { title: "Loteamentos" };

export default async function LoteamentosAdminPage() {
  const { permissoes } = await exigirRegraPagina("site.ver");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  const somenteLeitura = !permissoes.has("site.editar");
  const loteamentos = await listarLoteamentosAdmin();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Loteamentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A ordem desta lista é a ordem do site: o primeiro aparece primeiro. Deixe os mais próximos de Caratinga no
            topo.
          </p>
        </div>
        {!somenteLeitura && (
          <Link href={`/${adminPath}/conteudo/loteamentos/novo`} className={buttonVariants({ size: "lg" })}>
            <Plus aria-hidden="true" />
            Novo loteamento
          </Link>
        )}
      </div>

      {loteamentos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum loteamento cadastrado ainda.
        </p>
      ) : somenteLeitura ? (
        <ol aria-label="Loteamentos, na ordem em que aparecem no site" className="flex flex-col gap-2">
          {loteamentos.map((loteamento) => (
            <li key={loteamento.id} className="min-w-0 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 truncate font-medium">{loteamento.nome}</p>
                <span className="rounded bg-muted px-2 py-1 text-xs">
                  {loteamento.publicado ? "Publicado" : "Rascunho"}
                </span>
              </div>
              <p className="truncate text-sm text-muted-foreground">{loteamento.cidade ?? "Cidade não informada"}</p>
              <p className="text-sm text-muted-foreground">
                {loteamento.totalLotes === 0
                  ? "Nenhum lote cadastrado"
                  : `${loteamento.disponiveis} disponíveis de ${loteamento.totalLotes} lotes`}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <ListaLoteamentos adminPath={adminPath} loteamentos={loteamentos} />
      )}
    </div>
  );
}
