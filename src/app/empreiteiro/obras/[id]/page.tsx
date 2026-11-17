import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { exigirPapel } from "@/lib/auth/guard";
import { obterMinhaObra, listarMeusRelatos } from "@/lib/portal/obras/consultas";
import { LIMITE_PENDENTES_RELATO } from "@/lib/portal/obras/regras";
import { numeroPagina } from "@/lib/portal/andamento/admin";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import { ResumoObra } from "@/components/portal/obras/ResumoObra";
import { Relato } from "@/components/portal/obras/Relato";
import "@/components/portal/obras/obras.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Obra e relatos", robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string | string[] }> }) {
  await exigirPapel(["empreiteiro"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const obra = await obterMinhaObra(id);
  if (!obra) notFound();
  const pagina = numeroPagina((await searchParams).pagina);
  const relatos = await listarMeusRelatos(id, { pagina });
  return <div className="portal-entrada obras-painel">
    <div><Link className="portal-voltar" prefetch={false} href="/empreiteiro"><ArrowLeft size={16} aria-hidden="true" />Voltar às minhas obras</Link><h1 className="portal-titulo">{obra.nome}</h1></div>
    <section className="obras-cartao" aria-label="Progresso oficial"><ResumoObra obra={obra} /></section>
    <section className="obras-painel" aria-labelledby="historico"><div className="obras-resumo"><h2 id="historico" className="text-xl font-medium">Meus relatos</h2><Button asChild className="portal-botao"><Link prefetch={false} href={`/empreiteiro/obras/${id}/relatos/novo`}><Plus size={18} aria-hidden="true" />Novo relato</Link></Button></div>
      {obra.relatosPendentes >= LIMITE_PENDENTES_RELATO && <p className="obras-aviso">Você já tem cinco relatos pendentes. Aguarde a revisão da ABA antes de enviar outro.</p>}
      {!relatos.registros.length && <p className="portal-vazio">Nenhum relato nesta página.</p>}
      {relatos.registros.map((relato) => <article key={relato.id} className="obras-cartao"><Relato relato={relato} permitirNovo /></article>)}
      <Paginacao pagina={pagina} proxima={relatos.proximaPagina} base={`/empreiteiro/obras/${id}`} />
    </section>
  </div>;
}
