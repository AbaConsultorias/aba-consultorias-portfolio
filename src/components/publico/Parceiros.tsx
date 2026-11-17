import type { Parceiro } from "@/lib/conteudo/tipos";
import Image from "next/image";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { SERIF } from "./Titulo";

function Sequencia({ parceiros, copia = false }: { parceiros: Parceiro[]; copia?: boolean }) {
  return (
    <ul aria-hidden={copia || undefined} className={cn("flex shrink-0 items-center gap-5 pr-5 sm:gap-8 sm:pr-8", copia && "nova-marquee-copia")}>
      {parceiros.map(({ id, nome, logoUrl, siteUrl }) => (
        <li
          key={id}
          className="group flex h-24 w-48 shrink-0 items-center justify-center rounded-2xl border border-brand-dark/10 bg-white px-6 transition-[translate,box-shadow,border-color] duration-500 ease-out hover:-translate-y-1 hover:border-brand/30 hover:shadow-[0_18px_40px_-24px_rgba(28,40,50,0.45)] motion-reduce:hover:translate-y-0 sm:h-28 sm:w-56"
        >
          <a href={siteUrl ?? undefined} target={siteUrl ? "_blank" : undefined} rel={siteUrl ? "noopener noreferrer" : undefined} tabIndex={copia ? -1 : undefined} className="flex size-full items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-(--nova-acento)">
          <Image
            src={logoUrl}
            alt={copia ? "" : nome}
            width={414}
            height={160}
            sizes="224px"
            className="h-auto max-h-full w-full object-contain transition-[scale] duration-500 ease-out group-hover:scale-105 motion-reduce:group-hover:scale-100"
          />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Parceiros({ parceiros }: { parceiros: Parceiro[] }) {
  if (!parceiros.length) return null;
  return (
    <section aria-labelledby="parceiros-titulo" className="overflow-hidden py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-5 text-center sm:px-8">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-[#526B78] uppercase sm:text-xs">Parceiros</p>
        <h2 id="parceiros-titulo" className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-brand-dark sm:text-4xl">
          Marcas que <span className={cn(SERIF, "text-(--nova-acento)")}>confiam na ABA.</span>
        </h2>
      </div>
      <div
        className="nova-marquee mt-10 flex overflow-hidden py-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
        style={{ "--duracao": "38s" } as CSSProperties}
      >
        <div className="nova-marquee-trilha flex w-max">
          <Sequencia parceiros={parceiros} />
          <Sequencia parceiros={parceiros} copia />
        </div>
      </div>
    </section>
  );
}
