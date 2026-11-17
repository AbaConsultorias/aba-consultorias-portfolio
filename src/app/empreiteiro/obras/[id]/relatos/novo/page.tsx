import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterMinhaObra, obterMeuRelato } from "@/lib/portal/obras/consultas";
import { LIMITE_PENDENTES_RELATO } from "@/lib/portal/obras/regras";
import { NovoRelato } from "@/components/portal/obras/NovoRelato";
import "@/components/portal/obras/obras.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo relato", robots: { index: false, follow: false } };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ baseadoEm?: string | string[] }> }) {
  await exigirPapel(["empreiteiro"], { semAcesso: "entrar" });
  const { id } = await params;
  const consulta = z.object({ baseadoEm: z.uuid().optional() }).safeParse(await searchParams);
  if (!z.uuid().safeParse(id).success || !consulta.success) notFound();
  const obra = await obterMinhaObra(id);
  if (!obra) notFound();
  const base = consulta.data.baseadoEm ? await obterMeuRelato(consulta.data.baseadoEm) : null;
  if (consulta.data.baseadoEm && (!base || base.obraId !== id || base.status !== "devolvido")) notFound();
  return <div className="portal-entrada obras-painel"><div><Link className="portal-voltar" prefetch={false} href={`/empreiteiro/obras/${id}`}><ArrowLeft size={16} aria-hidden="true" />Voltar à obra</Link><p className="portal-sobretitulo">{obra.nome}</p><h1 className="portal-titulo">Novo relato</h1></div>
    {obra.relatosPendentes >= LIMITE_PENDENTES_RELATO ? <p className="obras-aviso">Você já tem cinco relatos pendentes nesta obra. Aguarde a revisão da ABA para enviar outro.</p> : <div className="obras-cartao"><NovoRelato key={base?.id ?? id} obraId={id} base={base} /></div>}
  </div>;
}
