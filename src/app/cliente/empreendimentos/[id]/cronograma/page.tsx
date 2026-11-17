import type { Metadata } from "next";
import { notFound } from "next/navigation";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { obterCronograma } from "@/lib/portal/cronograma/consultas";
import { mesValido } from "@/lib/portal/cronograma/regras";
import { GradeCronograma } from "@/components/portal/cronograma/GradeCronograma";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cronograma", robots: { index: false, follow: false } };

const lerMes = (valor: string | string[] | undefined) => (typeof valor === "string" && mesValido(valor) ? valor : undefined);

export default async function CronogramaPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string | string[]; ate?: string | string[] }>;
}) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  if (!await obterEmpreendimento(id)) notFound();
  const consulta = await searchParams;
  const de = lerMes(consulta.de);
  const ate = lerMes(consulta.ate);
  const cronograma = await obterCronograma(id, { de, ate });
  return (
    <section aria-labelledby="titulo-cronograma">
      <h2 id="titulo-cronograma" className="sr-only">Cronograma de pagamentos</h2>
      <GradeCronograma cronograma={cronograma} de={de} ate={ate} hrefLimpar={`/cliente/empreendimentos/${id}/cronograma`} />
    </section>
  );
}
