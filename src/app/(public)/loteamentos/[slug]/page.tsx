import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { Botao } from "@/components/publico/Botao";
import { ComoComecar } from "@/components/publico/ComoComecar";
import { Revelar } from "@/components/publico/Revelar";
import { Sobrancelha } from "@/components/publico/Sobrancelha";
import { TextoMascarado, Titulo } from "@/components/publico/Titulo";
import { FaixaProjetoCasa } from "@/components/publico/loteamentos/FaixaProjetoCasa";
import { GaleriaLoteamento } from "@/components/publico/loteamentos/GaleriaLoteamento";
import { LotesLoteamento } from "@/components/publico/loteamentos/LotesLoteamento";
import { linkWhatsApp } from "@/components/publico/dados";
import { listarLoteamentos, obterConfiguracoes, obterLoteamento } from "@/lib/conteudo/consultas";
import { metadadosDaPagina, resumir } from "@/lib/seo";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const loteamentos = await listarLoteamentos();
  return loteamentos.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const loteamento = await obterLoteamento(slug);
  if (!loteamento) return { title: "Loteamento não encontrado" };

  return metadadosDaPagina({
    titulo: loteamento.cidade ? `${loteamento.nome}, ${loteamento.cidade}` : loteamento.nome,
    descricao: resumir(loteamento.descricao) ?? `Conheça o loteamento ${loteamento.nome} e veja os lotes disponíveis.`,
    caminho: `/loteamentos/${loteamento.slug}`,
    imagem: loteamento.capaUrl ?? loteamento.bannerUrl,
    textoDaImagem: `Loteamento ${loteamento.nome}`,
  });
}

export default async function LoteamentoPage({ params }: Props) {
  const { slug } = await params;
  const [loteamento, configuracoes] = await Promise.all([obterLoteamento(slug), obterConfiguracoes()]);
  if (!loteamento) notFound();

  const fotoHero = loteamento.bannerUrl ?? loteamento.capaUrl;
  const fotoHeroMobile = loteamento.bannerMobileUrl;
  const altHero = `Vista do loteamento ${loteamento.nome}${loteamento.cidade ? `, em ${loteamento.cidade}` : ""}`;
  const mapsUrl = loteamento.mapsUrl?.startsWith("https://") ? loteamento.mapsUrl : null;
  const paragrafos = loteamento.descricao?.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) ?? [];

  return (
    <>
      <section aria-labelledby="loteamento-titulo" className="px-2 pt-2 sm:px-3">
        <div className="relative isolate flex min-h-[34rem] flex-col justify-end overflow-hidden rounded-[1.75rem] bg-brand-dark pt-36 pb-12 text-white sm:min-h-[40rem] sm:rounded-[2.5rem] sm:pb-20">
          {fotoHero && (
            <>
              {fotoHeroMobile && (
                <Image src={fotoHeroMobile} alt={altHero} fill sizes="100vw" className="-z-20 object-cover md:hidden" />
              )}
              <Image
                src={fotoHero}
                alt={altHero}
                fill
                sizes="100vw"
                preload={!fotoHeroMobile}
                className={fotoHeroMobile ? "nova-ken-burns -z-20 hidden object-cover md:block" : "nova-ken-burns -z-20 object-cover"}
              />
            </>
          )}
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-brand-dark via-brand-dark/55 to-brand-dark/25" />

          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            {loteamento.cidade && (
              <Revelar>
                <p className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm">
                  <MapPin aria-hidden="true" className="size-4 text-(--nova-acento-claro)" />
                  {loteamento.cidade}
                </p>
              </Revelar>
            )}
            <Revelar efeito="palavras" className="mt-6 max-w-4xl">
              <h1 id="loteamento-titulo" className="text-[2.6rem] leading-[1.03] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl">
                <TextoMascarado tomAcento="claro" partes={[loteamento.nome]} />
              </h1>
            </Revelar>
            <Revelar atraso={250} className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap">
              {mapsUrl && (
                <Botao href={mapsUrl} externo variante="claro">
                  Ver no Google Maps
                </Botao>
              )}
              <Botao href="#lotes" variante="contorno-claro">
                Ver os lotes
              </Botao>
            </Revelar>
          </div>
        </div>
      </section>

      {paragrafos.length > 0 && (
        <section aria-labelledby="sobre-loteamento-titulo" className="pt-20 sm:pt-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <Sobrancelha numero="01" texto="O loteamento" />
            <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:gap-12">
              <Titulo id="sobre-loteamento-titulo" className="lg:col-span-6" partes={["Conheça o", { acento: loteamento.nome }]} />
              <Revelar atraso={200} className="space-y-5 text-base leading-7 text-[#3b4d59] lg:col-span-6 sm:text-lg sm:leading-8">
                {paragrafos.map((paragrafo) => (
                  <p key={paragrafo} className="whitespace-pre-line">
                    {paragrafo}
                  </p>
                ))}
                {loteamento.endereco && (
                  <p className="flex items-start gap-2 text-sm text-[#526B78]">
                    <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {loteamento.endereco}
                  </p>
                )}
              </Revelar>
            </div>
          </div>
        </section>
      )}

      {loteamento.midias.length > 0 && (
        <section aria-labelledby="galeria-titulo" className="pt-20 sm:pt-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <Sobrancelha numero="02" texto="Galeria" />
            <Titulo id="galeria-titulo" className="mt-8 max-w-3xl" partes={["Veja o loteamento", { acento: "de perto." }]} />
            <div className="mt-12">
              <GaleriaLoteamento midias={loteamento.midias} nome={loteamento.nome} />
            </div>
          </div>
        </section>
      )}

      <section id="lotes" aria-labelledby="lotes-titulo" className="scroll-mt-28 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Sobrancelha numero="03" texto="Lotes" />
          <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <Titulo id="lotes-titulo" className="max-w-3xl" partes={["Escolha o seu", { acento: "lote." }]} />
            {loteamento.lotes.length > 0 && (
              <Revelar atraso={200}>
                <p className="max-w-sm text-sm leading-6 text-[#526B78]">
                  A situação dos lotes muda com frequência. Confirme a disponibilidade com a equipe antes de decidir.
                </p>
              </Revelar>
            )}
          </div>
          <div className="mt-12">
            <LotesLoteamento
              slug={loteamento.slug}
              nomeLoteamento={loteamento.nome}
              lotes={loteamento.lotes}
              mapaSvgUrl={loteamento.mapaSvgUrl}
              whatsapp={configuracoes.whatsapp}
            />
          </div>
          {loteamento.lotes.length > 0 && (
            <Revelar className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Botao href={linkWhatsApp(`Olá! Quero saber mais sobre o loteamento ${loteamento.nome}.`, configuracoes.whatsapp)} externo variante="whatsapp" icone="whatsapp">
                Falar com a equipe
              </Botao>
            </Revelar>
          )}
        </div>
      </section>

      <div className="space-y-2 pb-2 sm:space-y-3">
        <FaixaProjetoCasa configuracoes={configuracoes} nomeLoteamento={loteamento.nome} />
        <ComoComecar configuracoes={configuracoes} numero="04" />
      </div>
    </>
  );
}
