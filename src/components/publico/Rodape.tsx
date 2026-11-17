import type { Configuracoes } from "@/lib/conteudo/tipos";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { NAV_LINKS } from "@/components/site/nav-links";
import { linkWhatsApp } from "./dados";
import { IconeGoogle, IconeInstagram, IconeWhatsApp } from "./Icones";

const CLASSE_LINK =
  "group inline-flex min-h-10 items-center gap-2 text-sm text-brand-dark/80 transition-colors duration-500 hover:text-(--nova-acento) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)";

export function Rodape({ configuracoes }: { configuracoes: Configuracoes }) {
  const contatos = [
    { href: linkWhatsApp(undefined, configuracoes.whatsapp), rotulo: "WhatsApp", Icone: IconeWhatsApp },
    { href: configuracoes.instagramUrl, rotulo: configuracoes.instagramUsuario ? `Instagram @${configuracoes.instagramUsuario.replace(/^@/, "")}` : "Instagram", Icone: IconeInstagram },
    { href: configuracoes.googleAvaliacoesUrl, rotulo: "Avaliações no Google", Icone: IconeGoogle },
  ];
  return (
    <footer className="mt-24 border-t border-brand-dark/10 bg-white sm:mt-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:py-20">
        <div className="lg:col-span-5">
          <Link href="/" className="inline-block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)">
            <Image src="/marca/aba-logo.png" alt="ABA Consultoria — página inicial" width={1131} height={1391} sizes="80px" className="h-20 w-auto" />
          </Link>
          <p className="mt-6 max-w-sm text-sm leading-6 text-[#526B78]">
            Consultoria, regularização e projetos de água e esgoto para loteamentos, e os projetos da sua casa: arquitetônico, elétrico e hidrossanitário.
          </p>
        </div>

        <nav aria-label="Rodapé" className="lg:col-span-3">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-[#526B78] uppercase">Navegação</p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 lg:grid-cols-1">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} className={CLASSE_LINK}>
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/entrar" className={CLASSE_LINK}>
                Área do cliente
              </Link>
            </li>
          </ul>
        </nav>

        <div className="lg:col-span-4">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-[#526B78] uppercase">Contato</p>
          <ul className="mt-4 space-y-1">
            {contatos.filter((contato) => contato.href).map(({ href, rotulo, Icone }) => (
              <li key={rotulo}>
                <a href={href!} target="_blank" rel="noopener noreferrer" className={CLASSE_LINK}>
                  <Icone className="size-4 shrink-0" />
                  {rotulo}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-3.5 -translate-x-1 opacity-0 transition-[translate,opacity] duration-500 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:translate-x-0"
                  />
                  <span className="sr-only"> (abre em nova aba)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-brand-dark/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-[#526B78] sm:flex-row sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} ABA Consultoria. Todos os direitos reservados.</p>
          <p>Projetos, regularização e infraestrutura para loteamentos.</p>
        </div>
      </div>
    </footer>
  );
}
