import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { listarProjetos, obterProjeto, obterConfiguracoes } from "@/lib/conteudo/consultas";
import { metadadosDaPagina, resumir } from "@/lib/seo";
import { HeroInterno } from "@/components/publico/paginas/HeroInterno";
import { GaleriaProjeto } from "@/components/publico/paginas/GaleriaProjeto";
import { ChamadaContato, CONTAINER, Paragrafos } from "@/components/publico/paginas/Conteudo";
import { FotoParallax } from "@/components/publico/FotoParallax";
import { Revelar } from "@/components/publico/Revelar";

type Props = { params: Promise<{ slug: string }> };
export const revalidate = 300;
export async function generateStaticParams() { return (await listarProjetos()).map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const projeto = await obterProjeto((await params).slug);
  if (!projeto) notFound();
  return metadadosDaPagina({
    titulo: projeto.titulo,
    descricao: resumir(projeto.descricao),
    caminho: `/projetos/${projeto.slug}`,
    imagem: projeto.capaUrl,
    textoDaImagem: `Projeto ${projeto.titulo}`,
  });
}
export default async function ProjetoPage({ params }: Props) {
  const projeto = await obterProjeto((await params).slug);
  if (!projeto) notFound();
  const configuracoes = await obterConfiguracoes();
  return <>
    <HeroInterno sobrancelha="Projetos realizados" partes={[{ acento: projeto.titulo }]} atual={projeto.titulo} pai={{ href: "/projetos", nome: "Projetos" }} />
    <div className={`${CONTAINER} pt-16 sm:pt-24`}>
      {projeto.capaUrl && <FotoParallax src={projeto.capaUrl} alt={`Vista do projeto ${projeto.titulo}`} sizes="(min-width: 1280px) 1216px, 100vw" className="aspect-[4/3] rounded-[2rem] sm:aspect-[16/8]" />}
      <Revelar className="mx-auto mt-10 max-w-3xl">{projeto.cidade && <p className="mb-7 flex items-center gap-2 font-medium text-(--nova-acento)"><MapPin aria-hidden="true" className="size-5 shrink-0" />{projeto.cidade}</p>}<Paragrafos texto={projeto.descricao} /></Revelar>
      <GaleriaProjeto midias={projeto.midias} titulo={projeto.titulo} />
    </div>
    <ChamadaContato configuracoes={configuracoes} mensagem={`Olá! Conheci o projeto ${projeto.titulo} e quero conversar sobre meu projeto.`} />
  </>;
}
