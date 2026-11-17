import Link from "next/link";
import { notFound } from "next/navigation";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { listarObras } from "@/lib/portal/andamento/consultas";
import { Fotos } from "@/components/portal/andamento/Fotos";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
export const dynamic = "force-dynamic";
export const metadata = { title: "Obras", robots: { index: false, follow: false } };
const SITUACOES = { planejada: "Planejada", em_andamento: "Em andamento", concluida: "Concluída" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string }> }) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || !await obterEmpreendimento(id)) notFound();
  const consulta = z.coerce.number().int().min(1).max(100000).safeParse((await searchParams).pagina ?? 1);
  if (!consulta.success) notFound();
  const { obras, relatos } = await listarObras(id, { pagina: consulta.data });
  return <><section className="portal-secao"><h2>Obras</h2>{!obras.length && <p className="portal-vazio">Nenhuma obra cadastrada neste empreendimento.</p>}
    <div className="space-y-6">{obras.map((obra) => <Card key={obra.id} className="portal-cartao portal-entrada"><h3>{obra.nome}</h3><p>{SITUACOES[obra.situacao]} · {obra.percentual}%</p><progress className="h-2 w-full accent-primary" value={obra.percentual} max={100} aria-label={`Andamento oficial de ${obra.nome}`} /></Card>)}</div></section>
    {!!obras.length && <section className="portal-secao"><h2>Relatos aprovados</h2>{!relatos.registros.length && <p className="portal-vazio">{consulta.data > 1 ? "Não há relatos nesta página." : "Os relatos aparecerão após a revisão da equipe."}</p>}
      <div className="space-y-5">{relatos.registros.map((r) => <Card key={r.id} className="portal-cartao portal-entrada"><h3>{r.obraNome}</h3><time className="text-sm text-muted-foreground" dateTime={r.criadoEm}>{new Date(r.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time><p className="mt-2 whitespace-pre-wrap">{r.texto}</p><Fotos fotos={r.fotos} /></Card>)}</div>
      <nav aria-label="Páginas de relatos" className="mt-6 flex justify-between gap-4">{consulta.data > 1 && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`?pagina=${consulta.data - 1}`}><ChevronLeft size={18} aria-hidden="true" />Anteriores</Link></Button>}{relatos.proximaPagina && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`?pagina=${relatos.proximaPagina}`}>Próximos<ChevronRight size={18} aria-hidden="true" /></Link></Button>}</nav>
    </section>}</>;
}
