import type { Metadata } from "next";
import type { Configuracoes } from "@/lib/conteudo/tipos";

export const NOME_DO_SITE = "ABA Consultoria";
const IMAGEM_PADRAO = "/opengraph-image";

// Origem pública do site (NEXT_PUBLIC_SITE_URL). Sem a variável, ou com um valor
// que não seja https (http só em localhost), devolve null: sitemap e dados
// estruturados não podem sair com endereço errado. Em produção, avisa uma vez
// (build ou servidor) que o endereço está faltando ou inválido, sem quebrar o build.
let avisouSiteUrl = false;

export function urlDoSite() {
  const url = lerUrlDoSite();
  if (!url && process.env.NODE_ENV === "production" && !avisouSiteUrl) {
    avisouSiteUrl = true;
    console.warn(
      "[seo] NEXT_PUBLIC_SITE_URL ausente ou inválida (use https://dominio.com.br): sitemap, dados estruturados e imagens de compartilhamento saem sem o endereço do site.",
    );
  }
  return url;
}

function lerUrlDoSite() {
  const valor = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!valor) return null;

  try {
    const url = new URL(valor);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (local && url.protocol === "http:") ? url.origin : null;
  } catch {
    return null;
  }
}

export function resumir(texto: string | null | undefined, limite = 160) {
  const limpo = texto?.replace(/\s+/g, " ").trim();
  if (!limpo) return undefined;
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

type Pagina = {
  titulo: string | { absolute: string };
  descricao?: string;
  caminho: string;
  imagem?: string | null;
  textoDaImagem?: string;
};

// Um openGraph definido na página substitui o do layout inteiro, então cada
// página repete aqui o que precisa (site, idioma e imagem). O título social
// leva o nome do site escrito, sem depender do title.template do layout.
export function metadadosDaPagina({ titulo, descricao, caminho, imagem, textoDaImagem }: Pagina): Metadata {
  const tituloSocial = typeof titulo === "string" ? `${titulo} | ${NOME_DO_SITE}` : titulo.absolute;
  const imagens = imagem
    ? [{ url: imagem, alt: textoDaImagem ?? NOME_DO_SITE }]
    : [{ url: IMAGEM_PADRAO, width: 1200, height: 630, alt: NOME_DO_SITE }];

  return {
    title: titulo,
    description: descricao,
    alternates: { canonical: caminho },
    openGraph: {
      type: "website",
      siteName: NOME_DO_SITE,
      locale: "pt_BR",
      url: caminho,
      title: tituloSocial,
      description: descricao,
      images: imagens,
    },
    twitter: {
      card: "summary_large_image",
      title: tituloSocial,
      description: descricao,
      images: imagens.map(({ url }) => url),
    },
  };
}

export function dadosEstruturadosDaEmpresa(configuracoes: Configuracoes) {
  const site = urlDoSite();
  const redes = [configuracoes.instagramUrl, configuracoes.facebookUrl, configuracoes.linkedinUrl].filter(
    (url): url is string => Boolean(url),
  );
  const endereco = configuracoes.endereco?.replace(/\s+/g, " ").trim();

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: NOME_DO_SITE,
    description: "Consultoria, regularização e projetos de água e esgoto para loteamentos, e projetos para quem vai construir.",
    areaServed: "Leste de Minas Gerais",
    ...(site ? { url: site, image: `${site}${IMAGEM_PADRAO}` } : {}),
    ...(configuracoes.telefone ? { telephone: configuracoes.telefone } : {}),
    ...(configuracoes.email ? { email: configuracoes.email } : {}),
    ...(endereco ? { address: { "@type": "PostalAddress", streetAddress: endereco, addressCountry: "BR" } } : {}),
    ...(redes.length ? { sameAs: redes } : {}),
  };
}

// "<" vira <: um texto vindo do banco com "</script>" não fecha a tag.
export function serializarJsonLd(dados: object) {
  return JSON.stringify(dados).replace(/</g, "\\u003c");
}
