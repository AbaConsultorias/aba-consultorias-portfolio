import Link from "next/link";
import { notFound } from "next/navigation";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { listarProjetos, listarAtualizacoes } from "@/lib/portal/andamento/consultas";
import { ProjetosEmAndamento } from "@/components/portal/andamento/ProjetosEmAndamento";
import { Fotos } from "@/components/portal/andamento/Fotos";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
export const dynamic = "force-dynamic";
export const metadata = { title: "Andamento", robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string }> }) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || !await obterEmpreendimento(id)) notFound();
  const consulta = z.coerce.number().int().min(1).max(100000).safeParse((await searchParams).pagina ?? 1);
  if (!consulta.success) notFound();
  const [projetos, atualizacoes] = await Promise.all([listarProjetos(id), listarAtualizacoes(id, { pagina: consulta.data })]);
  return <><section className="portal-secao"><h2>Andamento dos projetos</h2><ProjetosEmAndamento projetos={projetos} empreendimentoId={id} /></section>
    <section className="portal-secao"><h2>Atualizações e visitas</h2>{!atualizacoes.registros.length && <p className="portal-vazio">Ainda não há atualizações publicadas.</p>}
      <div className="space-y-5">{atualizacoes.registros.map((a) => <Card key={a.id} className="portal-cartao portal-entrada"><h3>{a.titulo}</h3>{a.dataVisita && <p className="text-sm">Visita em {a.dataVisita.split("-").reverse().join("/")}</p>}<p className="whitespace-pre-wrap">{a.texto}</p><Fotos fotos={a.fotos} /></Card>)}</div>
      <nav aria-label="Páginas de atualizações" className="mt-6 flex justify-between gap-4">{consulta.data > 1 && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`?pagina=${consulta.data - 1}`}><ChevronLeft size={18} aria-hidden="true" />Anteriores</Link></Button>}{atualizacoes.proximaPagina && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`?pagina=${atualizacoes.proximaPagina}`}>Próximas<ChevronRight size={18} aria-hidden="true" /></Link></Button>}</nav>
    </section></>;
}
