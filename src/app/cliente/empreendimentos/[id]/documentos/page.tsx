import type { Metadata } from "next";
import { notFound } from "next/navigation";
import z from "zod";
import { DocumentosDoEmpreendimento } from "@/components/portal/documentos/DocumentosDoEmpreendimento";
import { exigirPapel } from "@/lib/auth/guard";
import { listarProjetos } from "@/lib/portal/andamento/consultas";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { listarEstruturaDocumentos, listarTodosDocumentos } from "@/lib/portal/documentos/consultas";
import { montarPainelDeDocumentos } from "@/lib/portal/documentos/painel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documentos", robots: { index: false, follow: false } };

// Tudo numa página só, na ordem da aba Projetos. Os links antigos com ?pagina= ou ?projeto= continuam funcionando:
// os parâmetros são ignorados e a âncora #projeto-<id> abre o cartão do projeto.
export default async function DocumentosPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const empreendimento = await obterEmpreendimento(id);
  if (!empreendimento) notFound();

  const [{ documentos, cortado }, projetos, estrutura] = await Promise.all([listarTodosDocumentos(id), listarProjetos(id), listarEstruturaDocumentos(id)]);
  return <DocumentosDoEmpreendimento empreendimentoId={id} painel={montarPainelDeDocumentos(documentos, projetos, estrutura.categorias)} cortado={cortado} />;
}
