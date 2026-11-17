import type { Metadata } from "next";
import { notFound } from "next/navigation";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { obterFinanceiro } from "@/lib/portal/financeiro/consultas";
import { dataCivilDeHoje } from "@/lib/portal/financeiro/regras";
import { PainelFinanceiro } from "@/components/portal/financeiro/PainelFinanceiro";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Financeiro", robots: { index: false, follow: false } };

export default async function FinanceiroPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!await obterEmpreendimento(id)) notFound();
  const { itens, resumo } = await obterFinanceiro(id);
  return (
    <section aria-labelledby="titulo-financeiro">
      <h2 id="titulo-financeiro" className="sr-only">Financeiro</h2>
      <PainelFinanceiro itens={itens} resumo={resumo} hoje={dataCivilDeHoje()} />
    </section>
  );
}
