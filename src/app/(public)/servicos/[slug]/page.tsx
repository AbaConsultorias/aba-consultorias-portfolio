import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { listarServicos, obterServico, obterConfiguracoes } from "@/lib/conteudo/consultas";
import { metadadosDaPagina, resumir } from "@/lib/seo";
import { HeroInterno } from "@/components/publico/paginas/HeroInterno";
import { CardsServicos, ChamadaContato, CONTAINER, Paragrafos } from "@/components/publico/paginas/Conteudo";
import { FotoParallax } from "@/components/publico/FotoParallax";
import { Revelar } from "@/components/publico/Revelar";
import { Titulo } from "@/components/publico/Titulo";

type Props = { params: Promise<{ slug: string }> };
export const revalidate = 300;
export async function generateStaticParams() { return (await listarServicos()).map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const servico = await obterServico((await params).slug);
  if (!servico) notFound();
  return metadadosDaPagina({
    titulo: servico.titulo,
    descricao: resumir(servico.resumo ?? servico.subtitulo),
    caminho: `/servicos/${servico.slug}`,
    imagem: servico.fotoUrl,
    textoDaImagem: `Serviço de ${servico.titulo} da ABA`,
  });
}

export default async function ServicoPage({ params }: Props) {
  const servico = await obterServico((await params).slug);
  if (!servico) notFound();
  const [configuracoes, relacionados] = await Promise.all([obterConfiguracoes(), listarServicos(servico.frente)]);
  const outros = relacionados.filter(({ id }) => id !== servico.id);
  return <>
    <HeroInterno sobrancelha={servico.frente === "casa" ? "Para sua casa" : "Para loteadores"} partes={[{ acento: servico.titulo }]} atual={servico.titulo} pai={{ href: "/servicos", nome: "Serviços" }} />
    <section aria-label="Sobre o serviço" className={`${CONTAINER} grid gap-10 py-16 sm:py-24 lg:grid-cols-2 lg:gap-16`}>
      <Revelar>{servico.subtitulo && <h2 className="mb-6 text-3xl font-semibold tracking-tight">{servico.subtitulo}</h2>}{servico.resumo && <p className="mb-8 text-xl leading-8">{servico.resumo}</p>}<Paragrafos texto={servico.conteudo} />
        {!!servico.itens.length && <ul aria-label="O que está incluído" className="mt-8 space-y-4 border-t border-brand-dark/15 pt-8">{servico.itens.map((item, i) => <li key={i} className="flex gap-3 leading-7"><Check aria-hidden="true" className="mt-1 size-5 shrink-0 text-(--nova-acento)" /><span>{item}</span></li>)}</ul>}
      </Revelar>
      {servico.fotoUrl && <FotoParallax src={servico.fotoUrl} alt={`Serviço de ${servico.titulo} da ABA`} sizes="(min-width: 1024px) 50vw, 100vw" className="aspect-[4/3] rounded-[2rem] lg:sticky lg:top-28" />}
    </section>
    <ChamadaContato configuracoes={configuracoes} mensagem={servico.mensagemWhatsApp ?? `Olá! Quero saber mais sobre ${servico.titulo}.`} />
    {!!outros.length && <section aria-labelledby="outros-titulo" className={`${CONTAINER} pb-20 sm:pb-28`}><Titulo id="outros-titulo" partes={["Outros serviços", { acento: "para você." }]} /><CardsServicos servicos={outros} /></section>}
  </>;
}
