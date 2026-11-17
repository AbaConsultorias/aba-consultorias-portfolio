import { notFound } from "next/navigation";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { listarProjetos } from "@/lib/portal/andamento/consultas";
import { Projetos } from "@/components/portal/andamento/Projetos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projetos", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || !await obterEmpreendimento(id)) notFound();
  const projetos = await listarProjetos(id);

  return (
    <section className="portal-secao">
      <h2>Projetos</h2>
      <Projetos projetos={projetos} empreendimentoId={id} />
    </section>
  );
}
