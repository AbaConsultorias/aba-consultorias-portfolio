import type { Metadata } from "next";
import { Revelar } from "@/components/publico/Revelar";
import { Sobrancelha } from "@/components/publico/Sobrancelha";
import { TextoMascarado } from "@/components/publico/Titulo";
import { ComoComecar } from "@/components/publico/ComoComecar";
import { CatalogoLoteamentos } from "@/components/publico/loteamentos/CatalogoLoteamentos";
import { FaixaProjetoCasa } from "@/components/publico/loteamentos/FaixaProjetoCasa";
import { listarLoteamentos, obterConfiguracoes } from "@/lib/conteudo/consultas";
import { metadadosDaPagina } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = metadadosDaPagina({
  titulo: "Loteamentos",
  descricao: "Conheça os loteamentos atendidos pela ABA Consultoria, veja os lotes disponíveis e fale com a equipe.",
  caminho: "/loteamentos",
});

export default async function LoteamentosPage() {
  const [loteamentos, configuracoes] = await Promise.all([listarLoteamentos(), obterConfiguracoes()]);

  return (
    <>
      <section aria-labelledby="loteamentos-titulo" className="px-2 pt-2 sm:px-3">
        <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-brand-dark pt-36 pb-16 text-white sm:rounded-[2.5rem] sm:pt-44 sm:pb-24">
          <div aria-hidden="true" className="absolute -top-32 -left-32 -z-10 size-[30rem] rounded-full bg-(--nova-acento)/30 blur-3xl" />
          <div aria-hidden="true" className="absolute top-0 right-0 -z-10 size-[28rem] translate-x-1/3 -translate-y-1/3 rounded-full border border-white/8" />
          <div aria-hidden="true" className="absolute top-0 right-0 -z-10 size-[18rem] translate-x-1/4 -translate-y-1/4 rounded-full border border-white/10" />

          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <Sobrancelha numero="01" texto="Loteamentos" tom="claro" />
            <Revelar efeito="palavras" className="mt-8 max-w-4xl">
              <h1 id="loteamentos-titulo" className="text-[2.4rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl">
                <TextoMascarado tomAcento="claro" partes={["Encontre o loteamento", { acento: "e escolha o seu lote." }]} />
              </h1>
            </Revelar>
            <Revelar atraso={250} className="mt-8 max-w-xl">
              <p className="text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
                Loteamentos que contam com o trabalho da ABA. Veja onde ficam, quais lotes estão disponíveis e fale direto com a equipe.
              </p>
            </Revelar>
          </div>
        </div>
      </section>

      <section aria-label="Catálogo de loteamentos" className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          {loteamentos.length ? (
            <CatalogoLoteamentos loteamentos={loteamentos} />
          ) : (
            <p className="rounded-[1.75rem] border border-dashed border-brand/35 bg-white p-10 text-center text-[#526B78]">
              Os loteamentos serão publicados em breve. Fale com a equipe pelo WhatsApp para conhecer as opções.
            </p>
          )}
        </div>
      </section>

      <div className="space-y-2 pb-2 sm:space-y-3">
        <FaixaProjetoCasa configuracoes={configuracoes} />
        <ComoComecar configuracoes={configuracoes} numero="02" />
      </div>
    </>
  );
}
