import type { Depoimento, Configuracoes } from "@/lib/conteudo/tipos";
import type { CSSProperties } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

import { Botao } from "./Botao";

import { IconeGoogle } from "./Icones";
import { NotaGoogle } from "./NotaGoogle";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { SERIF, Titulo } from "./Titulo";

// Repete a lista para a faixa ser mais larga que a tela e o laço do letreiro não deixar buraco.
const REPETICOES = 2;

function CartaoAvaliacao({ avaliacao }: { avaliacao: Depoimento }) {
  return (
    <figure className="flex h-full w-[19rem] shrink-0 flex-col rounded-[1.75rem] border border-brand-dark/8 bg-(--nova-fundo) p-7 transition-[translate,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1.5 hover:border-(--nova-acento)/40 hover:bg-white hover:shadow-[0_24px_50px_-30px_rgba(28,40,50,0.5)] motion-reduce:hover:translate-y-0 sm:w-[24rem]">
      <div className="flex items-center justify-between">
        <span aria-hidden="true" className={cn(SERIF, "text-6xl leading-[0.6] text-(--nova-acento)")}>
          “
        </span>
        {avaliacao.origem === "google" ? (
          <IconeGoogle className="size-5" />
        ) : (
          <span className="rounded-full bg-brand-dark/6 px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-brand uppercase">Depoimento</span>
        )}
      </div>
      {avaliacao.nota && (
        <>
          <p className="sr-only">Nota {avaliacao.nota} de 5.</p>
          <div aria-hidden="true" className="mt-5 flex gap-0.5">
            {Array.from({ length: 5 }, (_, indice) => (
              <Star key={indice} className={cn("size-4", indice < (avaliacao.nota ?? 0) ? "fill-[#F4B400] text-[#F4B400]" : "text-[#99A6AD]")} />
            ))}
          </div>
        </>
      )}
      <blockquote className="mt-5 flex-1 text-[0.95rem] leading-7 text-brand-dark">{avaliacao.texto}</blockquote>
      <figcaption className="mt-6 flex items-center gap-3 border-t border-brand-dark/10 pt-5">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-brand-dark text-sm font-semibold text-white">
          {avaliacao.nome.charAt(0)}
        </span>
        <span>
          <span className="block text-sm font-semibold text-brand-dark">{avaliacao.nome}</span>
          <span className="block text-xs text-[#526B78]">
            {avaliacao.origem === "google" ? [avaliacao.quando, "Google"].filter(Boolean).join(" · ") : "Cliente ABA"}
          </span>
        </span>
      </figcaption>
    </figure>
  );
}

function Sequencia({ depoimentos, copia = false }: { depoimentos: Depoimento[]; copia?: boolean }) {
  return (
    <ul aria-hidden={copia || undefined} className={cn("flex shrink-0 gap-5 pr-5", copia && "nova-marquee-copia")}>
      {Array.from({ length: REPETICOES }, (_, rodada) =>
        depoimentos.map((avaliacao) => (
          <li key={`${rodada}-${avaliacao.nome}`} aria-hidden={rodada > 0 || undefined} className={cn("flex", rodada > 0 && "nova-marquee-copia")}>
            <CartaoAvaliacao avaliacao={avaliacao} />
          </li>
        )),
      )}
    </ul>
  );
}

export function Avaliacoes({ depoimentos, configuracoes }: { depoimentos: Depoimento[]; configuracoes: Configuracoes }) {
  if (!depoimentos.length) return null;
  return (
    <section aria-labelledby="avaliacoes-titulo" className="overflow-hidden bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Sobrancelha numero="05" texto="Avaliações e depoimentos" />
        <div className="mt-8 grid gap-12 lg:grid-cols-12 lg:items-end lg:gap-10">
          <Titulo id="avaliacoes-titulo" className="lg:col-span-6" partes={["Quem contrata a ABA,", { acento: "recomenda." }]} />
          <Revelar atraso={150} className="lg:col-span-6 lg:justify-self-end">
            {configuracoes.googleNota !== null && configuracoes.googleTotal !== null && (
              <NotaGoogle nota={configuracoes.googleNota} total={configuracoes.googleTotal} />
            )}
          </Revelar>
        </div>
      </div>

      <Revelar className="mt-14 lg:mt-20">
        <div
          className="nova-marquee flex overflow-hidden py-3 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
          style={{ "--duracao": "60s" } as CSSProperties}
        >
          <div className="nova-marquee-trilha flex w-max">
            <Sequencia depoimentos={depoimentos} />
            <Sequencia depoimentos={depoimentos} copia />
          </div>
        </div>
      </Revelar>

      <Revelar className="mx-auto mt-10 flex max-w-7xl flex-col gap-3 px-5 sm:flex-row sm:px-8">
        {configuracoes.googleAvaliacoesUrl && <Botao href={configuracoes.googleAvaliacoesUrl} externo variante="escuro">
          Ver avaliações no Google
        </Botao>}
        {configuracoes.googleAvaliarUrl && <Botao href={configuracoes.googleAvaliarUrl} externo variante="contorno">
          Avaliar a ABA
        </Botao>}
      </Revelar>
    </section>
  );
}
