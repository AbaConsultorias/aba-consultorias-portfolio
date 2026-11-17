import { notFound } from "next/navigation";
import { exigirPapel } from "@/lib/auth/guard";
import { consultaPaginaSchema } from "@/lib/portal/fornecedor/campos";
import { listarMeusContratos } from "@/lib/portal/fornecedor/consultas";
import { ListaArquivos } from "@/components/portal/fornecedor/ListaArquivos";
import { PaginacaoFornecedor } from "@/components/portal/fornecedor/Paginacao";
import "@/components/portal/fornecedor/fornecedor.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Contratos | Fornecedor", robots: { index: false, follow: false } };
export default async function ContratosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirPapel(["fornecedor"], { semAcesso: "entrar" });
  const consulta = consultaPaginaSchema.safeParse(await searchParams);
  if (!consulta.success) notFound();
  const dados = await listarMeusContratos(consulta.data);
  return <div className="portal-entrada"><h1 className="portal-titulo">Contratos</h1><p className="portal-descricao">Baixe os contratos disponibilizados pela ABA.</p><ListaArquivos registros={dados.registros} /><PaginacaoFornecedor pagina={consulta.data.pagina} proximaPagina={dados.proximaPagina} base="/fornecedor/contratos" /></div>;
}
