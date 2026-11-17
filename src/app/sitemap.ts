import type { MetadataRoute } from "next";
import { listarLoteamentos, listarProjetos, listarServicos } from "@/lib/conteudo/consultas";
import { urlDoSite } from "@/lib/seo";

export const revalidate = 300;

const PAGINAS_FIXAS = ["/", "/servicos", "/projetos", "/loteamentos", "/sobre", "/contato"];

// As funções de leitura usam o client anon: o RLS já entrega só o publicado.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = urlDoSite();
  if (!site) return [];

  const [servicos, projetos, loteamentos] = await Promise.all([listarServicos(), listarProjetos(), listarLoteamentos()]);
  const caminhos = [
    ...PAGINAS_FIXAS,
    ...servicos.map(({ slug }) => `/servicos/${slug}`),
    ...projetos.map(({ slug }) => `/projetos/${slug}`),
    ...loteamentos.map(({ slug }) => `/loteamentos/${slug}`),
  ];

  return caminhos.map((caminho) => ({ url: `${site}${caminho}` }));
}
