import { notFound } from "next/navigation";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { listar } from "@/app/api/(modules)/adm-interno/conteudo/projetos/service";
import { ListaConteudo } from "@/components/admin/conteudo/ListaConteudo";
import type { Registro } from "@/components/admin/conteudo/recursos";
export default async function Pagina() {
    const { permissoes } = await exigirRegraPagina("site.ver");
    const adminPath = obterAdminPath();
    if (!adminPath)
        notFound();
    const resultado = await listar({}).catch(() => null);
    if (!resultado)
        return <section role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Conteúdo indisponível</h1><p className="mt-2 text-muted-foreground">Não foi possível carregar os registros. Atualize a página para tentar novamente.</p></section>;
    return <ListaConteudo adminPath={adminPath} recurso="projetos" registros={resultado.registros as Registro[]} somenteLeitura={!permissoes.has("site.editar")}/>;
}
