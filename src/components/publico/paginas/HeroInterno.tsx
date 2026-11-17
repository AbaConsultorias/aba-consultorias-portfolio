import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Sobrancelha } from "../Sobrancelha";
import { TextoMascarado, type ParteTitulo } from "../Titulo";
import { LinhaCurva } from "../LinhaCurva";

export function HeroInterno({ sobrancelha, partes, atual, pai }: {
  sobrancelha: string;
  partes: readonly ParteTitulo[];
  atual: string;
  pai?: { href: string; nome: string };
}) {
  return (
    <section aria-labelledby="pagina-titulo" className="relative isolate overflow-hidden bg-brand-dark pt-36 pb-14 text-white sm:pt-44 sm:pb-20">
      <LinhaCurva className="top-0 text-white/10" />
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Sobrancelha numero="ABA" texto={sobrancelha} tom="claro" />
        <h1 id="pagina-titulo" className="nova-entrada mt-7 max-w-5xl text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance [overflow-wrap:anywhere] sm:text-6xl lg:text-7xl">
          <TextoMascarado partes={partes} tomAcento="claro" />
        </h1>
        <nav aria-label="Caminho de navegação" className="nova-surgir mt-9 text-sm text-white/80">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/" className="rounded transition-colors duration-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Início</Link></li>
            {pai && <li className="flex items-center gap-2"><ChevronRight aria-hidden="true" className="size-3" /><Link href={pai.href} className="rounded transition-colors duration-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{pai.nome}</Link></li>}
            <li className="flex min-w-0 items-center gap-2"><ChevronRight aria-hidden="true" className="size-3 shrink-0" /><span aria-current="page" className="break-words">{atual}</span></li>
          </ol>
        </nav>
      </div>
    </section>
  );
}
