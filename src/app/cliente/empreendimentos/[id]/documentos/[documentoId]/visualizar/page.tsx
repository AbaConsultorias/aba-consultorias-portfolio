import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import z from "zod";
import { VisualizadorPdf } from "@/components/portal/documentos/VisualizadorPdf";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visualizar documento", robots: { index: false, follow: false } };

const paramsSchema = z.object({ id: z.uuid(), documentoId: z.uuid() });
const documentoSchema = z.object({ titulo: z.string(), equipamento: z.string().nullable(), equipamento_papel: z.enum(["simo", "laudo"]) });

// A leitura passa pelo RLS: o cliente só enxerga documento liberado do próprio empreendimento. Quem não é SIMO cai no 404.
export default async function VisualizarSimoPage({ params }: { params: Promise<{ id: string; documentoId: string }> }) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const resultado = paramsSchema.safeParse(await params);
  if (!resultado.success) notFound();
  const { id, documentoId } = resultado.data;
  if (!await obterEmpreendimento(id)) notFound();

  const sessao = await createClient();
  const { data, error } = await sessao.from("documentos").select("titulo,equipamento,equipamento_papel")
    .eq("id", documentoId).eq("empreendimento_id", id).eq("liberado_cliente", true).maybeSingle();
  const documento = error ? null : documentoSchema.safeParse(data);
  if (!documento?.success) notFound();

  return (
    <section className="portal-secao">
      <Link className="portal-voltar" href={`/cliente/empreendimentos/${id}/documentos`} prefetch={false}>
        <ArrowLeft size={16} aria-hidden="true" />Voltar aos documentos
      </Link>
      <h2>{documento.data.equipamento ? `${documento.data.equipamento_papel === "simo" ? "SIMO" : "Laudo"} · ${documento.data.equipamento}` : documento.data.titulo}</h2>
      <VisualizadorPdf documentoId={documentoId} />
    </section>
  );
}
