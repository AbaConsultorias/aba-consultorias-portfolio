import type { Metadata } from "next";
import { listarServicos, obterConfiguracoes } from "@/lib/conteudo/consultas";
import { HeroInterno } from "@/components/publico/paginas/HeroInterno";
import { CardsServicos, CONTAINER } from "@/components/publico/paginas/Conteudo";
import { metadadosDaPagina } from "@/lib/seo";
import { ComoComecar } from "@/components/publico/ComoComecar";
import { Sobrancelha } from "@/components/publico/Sobrancelha";
import { Titulo } from "@/components/publico/Titulo";

export const revalidate = 300;
export function generateMetadata(): Metadata {
  return metadadosDaPagina({ titulo: "Serviços", descricao: "Consultoria e projetos para loteadores e para sua casa. Conheça as duas frentes de atuação da ABA.", caminho: "/servicos" });
}

export default async function ServicosPage() {
  const [loteadores, casa, configuracoes] = await Promise.all([listarServicos("loteadores"), listarServicos("casa"), obterConfiguracoes()]);
  return <>
    <HeroInterno sobrancelha="Nossos serviços" partes={["Cuidado técnico em", { acento: "cada etapa." }]} atual="Serviços" />
    {([{ id: "loteadores", nome: "Para loteadores", titulo: "Seu loteamento,", acento: "do início à aprovação.", servicos: loteadores }, { id: "casa", nome: "Para sua casa", titulo: "O seu jeito de morar,", acento: "bem projetado.", servicos: casa }] as const).map((frente, i) => <section key={frente.id} id={frente.id} aria-labelledby={`${frente.id}-titulo`} className={`${CONTAINER} scroll-mt-24 py-16 sm:py-24`}>
      <Sobrancelha numero={`0${i + 1}`} texto={frente.nome} />
      <Titulo id={`${frente.id}-titulo`} className="mt-7 max-w-3xl" partes={[frente.titulo, { acento: frente.acento }]} />
      <CardsServicos servicos={frente.servicos} />
    </section>)}
    <ComoComecar configuracoes={configuracoes} numero="03" />
  </>;
}
