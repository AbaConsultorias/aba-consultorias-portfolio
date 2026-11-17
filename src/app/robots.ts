import type { MetadataRoute } from "next";
import { urlDoSite } from "@/lib/seo";

// Nunca citar o caminho secreto da equipe aqui: o robots.txt é público.
export default function robots(): MetadataRoute.Robots {
  const site = urlDoSite();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/cliente", "/empreiteiro", "/fornecedor", "/trocar-senha", "/entrar"],
    },
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  };
}
