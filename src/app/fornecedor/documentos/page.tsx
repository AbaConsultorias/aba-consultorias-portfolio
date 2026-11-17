import { notFound } from "next/navigation";
import { exigirPapel } from "@/lib/auth/guard";
import { consultaPaginaSchema } from "@/lib/portal/fornecedor/campos";
import { listarMeusDocumentos, listarMeusFornecedores, obterFinanceiroFornecedor } from "@/lib/portal/fornecedor/consultas";
import { ListaArquivos } from "@/components/portal/fornecedor/ListaArquivos";
import { EnviarArquivo } from "@/components/portal/fornecedor/EnviarArquivo";
import { PaginacaoFornecedor } from "@/components/portal/fornecedor/Paginacao";
import "@/components/portal/fornecedor/fornecedor.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Documentos | Fornecedor", robots: { index: false, follow: false } };
export default async function DocumentosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirPapel(["fornecedor"], { semAcesso: "entrar" });
  const consulta = consultaPaginaSchema.safeParse(await searchParams);
  if (!consulta.success) notFound();
  const [documentos, fornecedores, financeiro] = await Promise.all([listarMeusDocumentos(consulta.data), listarMeusFornecedores(), obterFinanceiroFornecedor()]);
  const empreendimentos = [...new Map(financeiro.itens.map((i) => [`${i.fornecedorId}:${i.empreendimentoId}`, { valor: i.empreendimentoId, nome: `${i.empreendimentoNome ?? "Empreendimento"} — ${i.fornecedorNome ?? "Fornecedor"}`, fornecedorId: i.fornecedorId ?? undefined }])).values()];
  return <div className="portal-entrada"><h1 className="portal-titulo">Documentos</h1><p className="portal-descricao">Envie notas fiscais, certidões e comprovantes. Se um documento for recusado, corrija o arquivo e faça um novo envio.</p>
    {fornecedores.length ? <EnviarArquivo fornecedores={fornecedores.map((f) => ({ valor: f.id, nome: f.nome }))} empreendimentos={empreendimentos} /> : <p className="portal-vazio">Nenhum fornecedor ativo vinculado. Entre em contato com a equipe ABA.</p>}
    <section className="portal-secao"><h2>Documentos enviados</h2><ListaArquivos registros={documentos.registros} /><PaginacaoFornecedor pagina={consulta.data.pagina} proximaPagina={documentos.proximaPagina} base="/fornecedor/documentos" /></section>
  </div>;
}
