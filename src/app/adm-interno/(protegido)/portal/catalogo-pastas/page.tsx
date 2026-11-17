import Link from "next/link";
import { listarCatalogo } from "@/app/api/(modules)/adm-interno/portal/catalogo-pastas/service";
import { EditorDoCatalogo } from "@/components/admin/portal/pasta/EditorDoCatalogo";
import { opcoes, prepararAdminComRegra } from "@/lib/portal/andamento/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catálogo de pastas", robots: { index: false, follow: false } };

// Só o admin: o catálogo decide quais projetos e regras a montagem sugere para todos os empreendimentos.
export default async function Page() {
  const { adminPath } = await prepararAdminComRegra("so-admin");
  const [itens, modelos] = await Promise.all([listarCatalogo(), opcoes("modelos_etapas")]);
  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Gestão do portal</p>
      <h1 className="portal-titulo">Catálogo de pastas</h1>
      <p className="portal-descricao">
        O que o site procura nas pastas do servidor ao montar um empreendimento. Mudar o catálogo não altera projetos nem regras já criados; vale para as próximas montagens.
      </p>
      <Link href={`/${adminPath}/portal/empreendimentos`} prefetch={false} className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
        Voltar aos empreendimentos
      </Link>
      <div className="portal-secao">
        <EditorDoCatalogo adminPath={adminPath} itens={itens} modelos={modelos} />
      </div>
    </div>
  );
}
