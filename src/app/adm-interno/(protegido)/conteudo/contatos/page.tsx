import { notFound } from "next/navigation";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { listar } from "@/app/api/(modules)/adm-interno/conteudo/contatos/service";
import { consultaSchema } from "@/app/api/(modules)/adm-interno/conteudo/contatos/schema";
import { ContatosRecebidos, type Contato } from "@/components/admin/conteudo/ContatosRecebidos";
export default async function Pagina({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { permissoes } = await exigirRegraPagina("contatos.ver");
    const adminPath = obterAdminPath();
    if (!adminPath)
        notFound();
    const validacao = consultaSchema.safeParse(await searchParams);
    if (!validacao.success)
        notFound();
    const consulta = validacao.data;
    const resultado = await listar(consulta).catch(() => null);
    if (!resultado)
        return <section role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Conteúdo indisponível</h1><p className="mt-2 text-muted-foreground">Não foi possível carregar os registros. Atualize a página para tentar novamente.</p></section>;
    return <ContatosRecebidos adminPath={adminPath} registros={resultado.registros as Contato[]} filtro={consulta.lido} pagina={consulta.pagina} total={resultado.total} somenteLeitura={!permissoes.has("contatos.editar")}/>;
}
