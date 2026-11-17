import { notFound } from "next/navigation";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { consultaSchema } from "@/app/api/(modules)/adm-interno/portal/fornecedor-documentos/schema";
import { listar as listarFornecedores } from "@/app/api/(modules)/adm-interno/portal/fornecedores/service";
import { listarDocumentosAdmin } from "@/lib/portal/fornecedor/consultas";
import { ListaArquivos } from "@/components/portal/fornecedor/ListaArquivos";
import { PaginacaoFornecedor } from "@/components/portal/fornecedor/Paginacao";
import { RevisarDocumento } from "@/components/admin/portal/fornecedor/RevisarDocumento";
import { ExcluirFornecedorRegistro } from "@/components/admin/portal/fornecedor/Excluir";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import "@/components/portal/fornecedor/fornecedor.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Revisar documentos | ABA", robots: { index: false, follow: false } };
export default async function DocumentosFornecedorAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const acesso = await exigirRegraPagina("fornecedores.ver");
  const podeEditar = acesso.permissoes.has("fornecedores.editar");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const params = await searchParams;
  const consulta = consultaSchema.safeParse({ ...params, fornecedorId: params.fornecedorId || undefined, status: params.status === "todos" ? undefined : params.status ?? "pendente" });
  if (!consulta.success) notFound();
  const [documentos, fornecedores] = await Promise.all([listarDocumentosAdmin(consulta.data, consulta.data), listarFornecedores({})]);
  const base = `/${adminPath}/portal/fornecedor-documentos`;
  const filtro = new URLSearchParams({ status: consulta.data.status ?? "todos", ...(consulta.data.fornecedorId ? { fornecedorId: consulta.data.fornecedorId } : {}) });
  return <div className="portal-entrada"><h1 className="portal-titulo">Documentos de fornecedores</h1><p className="portal-descricao">Confira o arquivo antes de aprovar. Ao recusar, explique o que precisa ser corrigido.</p>
    <form method="GET" action={base} className="forn-filtros"><label>Situação<select name="status" defaultValue={consulta.data.status ?? "todos"}><option value="pendente">Aguardando revisão</option><option value="aprovado">Aprovados</option><option value="recusado">Recusados</option><option value="todos">Todas</option></select></label><label>Fornecedor<select name="fornecedorId" defaultValue={consulta.data.fornecedorId ?? ""}><option value="">Todos</option>{fornecedores.registros.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></label><Button type="submit" variant="outline"><Filter aria-hidden="true" />Filtrar</Button></form>
    {!documentos.registros.length && <p className="portal-vazio">Nenhum documento nesta situação.</p>}
    {documentos.registros.map((d) => <section key={d.id} className="portal-secao"><h2>{fornecedores.registros.find((f) => f.id === d.fornecedorId)?.nome ?? "Fornecedor"}</h2><ListaArquivos registros={[d]} />{podeEditar && d.status === "pendente" && <div className="forn-caixa"><RevisarDocumento id={d.id} adminPath={adminPath} /></div>}{acesso.perfil.papel === "admin" && <ExcluirFornecedorRegistro endpoint={`/${adminPath}/api/portal/fornecedor-documentos`} id={d.id} rotulo="Excluir documento" />}</section>)}
    <PaginacaoFornecedor pagina={consulta.data.pagina} proximaPagina={documentos.proximaPagina} base={`${base}?${filtro}`} />
  </div>;
}
