import type { Metadata } from "next";
import { listarProjetos, obterConfiguracoes } from "@/lib/conteudo/consultas";
import { metadadosDaPagina } from "@/lib/seo";
import { HeroInterno } from "@/components/publico/paginas/HeroInterno";
import { GradeProjetos } from "@/components/publico/paginas/GradeProjetos";
import { ChamadaContato, CONTAINER } from "@/components/publico/paginas/Conteudo";

export const revalidate = 300;
export function generateMetadata(): Metadata { return metadadosDaPagina({ titulo: "Projetos", descricao: "Conheça os projetos da ABA em loteamentos, residências e infraestrutura.", caminho: "/projetos" }); }
export default async function ProjetosPage() {
  const [projetos, configuracoes] = await Promise.all([listarProjetos(), obterConfiguracoes()]);
  return <><HeroInterno sobrancelha="Nosso trabalho" partes={["Projetos que saem", { acento: "do papel." }]} atual="Projetos" /><section aria-label="Projetos realizados" className={`${CONTAINER} pt-16 sm:pt-24`}><GradeProjetos projetos={projetos} /></section><ChamadaContato configuracoes={configuracoes} /></>;
}
