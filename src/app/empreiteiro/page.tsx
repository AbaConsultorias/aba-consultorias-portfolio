import Link from "next/link";
import { ArrowUpRight, HardHat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exigirPapel } from "@/lib/auth/guard";
import { listarMinhasObras } from "@/lib/portal/obras/consultas";
import { ResumoObra } from "@/components/portal/obras/ResumoObra";
import "@/components/portal/obras/obras.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minhas obras", robots: { index: false, follow: false } };
export default async function Page() {
  await exigirPapel(["empreiteiro"], { semAcesso: "entrar" });
  const obras = await listarMinhasObras();
  return <div className="portal-entrada obras-painel">
    <div><p className="portal-sobretitulo">Área do empreiteiro</p><h1 className="portal-titulo">Minhas obras</h1><p className="portal-descricao">Acompanhe o progresso oficial e envie relatos para a revisão da ABA.</p></div>
    {!obras.length ? <div className="portal-vazio"><HardHat aria-hidden="true" className="mb-4 text-primary" /><h2>Nenhuma obra atribuída</h2><p>Entre em contato com a ABA para conferir seu acesso às obras.</p></div> : <div className="portal-grade">{obras.map((obra) => <article className="obras-cartao space-y-5" key={obra.id}><h2>{obra.nome}</h2><ResumoObra obra={obra} /><Button asChild className="portal-botao"><Link href={`/empreiteiro/obras/${obra.id}`} prefetch={false}>Ver obra e relatos<ArrowUpRight size={18} aria-hidden="true" /></Link></Button></article>)}</div>}
  </div>;
}
