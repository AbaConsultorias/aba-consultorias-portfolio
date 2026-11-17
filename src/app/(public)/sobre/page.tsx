import type { Metadata } from "next";
import { listarDepoimentos, listarParceiros, obterConfiguracoes } from "@/lib/conteudo/consultas";
import { metadadosDaPagina, resumir } from "@/lib/seo";
import { HeroInterno } from "@/components/publico/paginas/HeroInterno";
import { ChamadaContato, CONTAINER, Paragrafos } from "@/components/publico/paginas/Conteudo";
import { Avaliacoes } from "@/components/publico/Avaliacoes";
import { Parceiros } from "@/components/publico/Parceiros";
import { Revelar } from "@/components/publico/Revelar";
import { Titulo } from "@/components/publico/Titulo";
import { Botao } from "@/components/publico/Botao";

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> {
  const c = await obterConfiguracoes();
  return metadadosDaPagina({ titulo: "Sobre a ABA", descricao: resumir(c.sobreTexto) ?? "Conheça a ABA Consultoria e suas duas frentes: projetos para loteadores e para sua casa.", caminho: "/sobre" });
}
export default async function SobrePage() {
  const [c, parceiros, depoimentos] = await Promise.all([obterConfiguracoes(), listarParceiros(), listarDepoimentos()]);
  return <>
    <HeroInterno sobrancelha="Sobre a ABA" partes={["Quem projeta", { acento: "também executa." }]} atual="Sobre" />
    <section aria-labelledby="sobre-titulo" className={`${CONTAINER} grid gap-10 py-16 sm:py-24 lg:grid-cols-2 lg:gap-20`}>
      <Titulo id="sobre-titulo" partes={[c.sobreTitulo ?? "Cuidado com o projeto.", { acento: "Compromisso com cada etapa." }]} />
      <Revelar><Paragrafos texto={c.sobreTexto ?? "A ABA atua com consultoria, regularização e projetos para loteamentos, além de projetos para quem vai construir sua casa.\n\nAtendemos empreendimentos junto à Copasa ou à concessionária responsável, conforme as necessidades de cada projeto."} /></Revelar>
    </section>
    <section aria-labelledby="frentes-titulo" className={`${CONTAINER} pb-16 sm:pb-24`}>
      <Titulo id="frentes-titulo" partes={["Duas frentes,", { acento: "o mesmo cuidado." }]} />
      <div className="mt-10 grid gap-6 md:grid-cols-2">{[{ nome: "Para loteadores", texto: "Consultoria, regularização e projetos de água e esgoto para seu loteamento, junto à Copasa ou a outra concessionária.", href: "/servicos#loteadores" }, { nome: "Para sua casa", texto: "Projetos para construir sua casa, com atenção às necessidades da obra desde o começo.", href: "/servicos#casa" }].map((frente, i) => <Revelar key={frente.nome} atraso={i * 150} className="rounded-[2rem] border border-brand-dark/10 bg-white p-8 sm:p-10"><h3 className="text-2xl font-semibold">{frente.nome}</h3><p className="mt-5 mb-8 leading-8 text-[#526B78]">{frente.texto}</p><Botao href={frente.href} variante="contorno">Conheça os serviços</Botao></Revelar>)}</div>
    </section>
    <Parceiros parceiros={parceiros} /><Avaliacoes depoimentos={depoimentos} configuracoes={c} /><ChamadaContato configuracoes={c} />
  </>;
}
