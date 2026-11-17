import type { Metadata } from "next";
import "./globals.css";
import { Plus_Jakarta_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import { urlDoSite } from "@/lib/seo";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

// Sem NEXT_PUBLIC_SITE_URL o Next também cai em localhost; só as imagens de
// compartilhamento dependem disso (sitemap e robots ficam sem endereço).
export const metadata: Metadata = {
  metadataBase: new URL(urlDoSite() ?? "http://localhost:3000"),
  title: {
    default: "ABA Consultoria",
    template: "%s | ABA Consultoria",
  },
  description:
    "Consultoria, regularização e projetos de água e esgoto para loteamentos, e projetos para quem vai construir.",
  openGraph: { type: "website", siteName: "ABA Consultoria", locale: "pt_BR" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={cn("font-sans", fontSans.variable)}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
