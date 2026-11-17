import type { Metadata } from "next";
import { Hero } from "@/components/publico/Hero";
import { Servicos } from "@/components/publico/Servicos";
import { ParaSuaCasa } from "@/components/publico/ParaSuaCasa";
import { ProjetosRealizados } from "@/components/publico/ProjetosRealizados";
import { FaixaLoteamentos } from "@/components/publico/FaixaLoteamentos";
import { Instagram } from "@/components/publico/Instagram";
import { Avaliacoes } from "@/components/publico/Avaliacoes";
import { Parceiros } from "@/components/publico/Parceiros";
import { LotesAVenda } from "@/components/publico/LotesAVenda";
import { QuemSomos } from "@/components/publico/QuemSomos";
import { ComoComecar } from "@/components/publico/ComoComecar";
import {
  obterConfiguracoes,
  listarBannersHero,
  listarServicos,
  listarProjetos,
  listarLoteamentos,
  listarDepoimentos,
  listarParceiros,
  listarVideosInstagram,
} from "@/lib/conteudo/consultas";
import { dadosEstruturadosDaEmpresa, metadadosDaPagina, serializarJsonLd } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = metadadosDaPagina({
  titulo: { absolute: "ABA Consultoria — Projetos e regularização de loteamentos" },
  descricao: "Consultoria, regularização e projetos de água e esgoto para aprovar loteamentos, e os projetos da sua casa.",
  caminho: "/",
});

export default async function Home() {
  const [configuracoes, banners, servicosLoteadores, servicosCasa, projetos, loteamentos, depoimentos, parceiros, videos] = await Promise.all([
    obterConfiguracoes(),
    listarBannersHero(),
    listarServicos("loteadores"),
    listarServicos("casa"),
    listarProjetos(),
    listarLoteamentos(),
    listarDepoimentos(),
    listarParceiros(),
    listarVideosInstagram(),
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializarJsonLd(dadosEstruturadosDaEmpresa(configuracoes)) }} />
      <Hero banners={banners} configuracoes={configuracoes} />
      {!servicosLoteadores.length && <span id="servicos" />}
      <Servicos servicos={servicosLoteadores} />
      {!servicosCasa.length && <span id="casa-titulo" />}
      <ParaSuaCasa servicos={servicosCasa} configuracoes={configuracoes} />
      {!projetos.length && <span id="projetos-titulo" />}
      <ProjetosRealizados projetos={projetos.slice(0, 5)} />
      <FaixaLoteamentos loteamentos={loteamentos} />
      <Instagram videos={videos} configuracoes={configuracoes} />
      <Avaliacoes depoimentos={depoimentos} configuracoes={configuracoes} />
      <Parceiros parceiros={parceiros} />
      {!loteamentos.length && <span id="lotes-titulo" />}
      <LotesAVenda loteamentos={loteamentos.slice(0, 6)} configuracoes={configuracoes} />
      <QuemSomos configuracoes={configuracoes} loteamento={loteamentos[1] ?? loteamentos[0]} />
      <ComoComecar configuracoes={configuracoes} />
    </>
  );
}
