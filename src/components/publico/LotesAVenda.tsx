import type { LoteamentoResumo, Configuracoes } from "@/lib/conteudo/tipos";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, House, MapPin } from "lucide-react";
import { Botao } from "./Botao";
import { linkWhatsApp } from "./dados";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

export function LotesAVenda({ loteamentos, configuracoes }: { loteamentos: LoteamentoResumo[]; configuracoes: Configuracoes }) {
  if (!loteamentos.length) return null;
  return (
    <section aria-labelledby="lotes-titulo" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Sobrancelha numero="06" texto="Lotes à venda" />
        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <Titulo id="lotes-titulo" className="max-w-3xl" partes={["Conheça os loteamentos", { acento: "e escolha o seu lote." }]} />
          <Revelar atraso={200}>
            <Botao href="/loteamentos" variante="contorno">
              Ver todos os loteamentos
            </Botao>
          </Revelar>
        </div>

        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
          {loteamentos.map((lote, indice) => (
            <li key={lote.slug} className="min-w-0">
              <Revelar atraso={(indice % 3) * 120} className="h-full">
                <article className="group h-full overflow-hidden rounded-[1.75rem] border border-brand-dark/8 bg-white transition-[translate,box-shadow,border-color] duration-500 hover:-translate-y-1.5 hover:border-brand-dark/15 hover:shadow-[0_30px_60px_-34px_rgba(40,84,104,0.55)] motion-reduce:hover:translate-y-0">
                  <Link
                    href={`/loteamentos/${lote.slug}`}
                    className="block h-full rounded-[1.75rem] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-brand-dark/10">
                      {(lote.capaUrl ?? lote.bannerUrl) && <Image
                        src={(lote.capaUrl ?? lote.bannerUrl)!}
                        alt={lote.nome}
                        fill
                        sizes="(max-width: 639px) 92vw, (max-width: 1023px) 46vw, 400px"
                        className="object-cover transition-[scale] duration-[900ms] group-hover:scale-[1.07] motion-reduce:group-hover:scale-100"
                      />}
                    </div>
                    <div className="p-6">
                      <p className="flex items-start gap-1.5 text-xs text-[#526B78]">
                        <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                        {lote.cidade}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold tracking-tight text-brand-dark">{lote.nome}</h3>
                      <div className="mt-5 flex items-center justify-between border-t border-brand-dark/10 pt-4 text-sm font-semibold text-brand">
                        Conhecer loteamento
                        <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-(--nova-fundo) transition-[background-color,color,rotate] duration-500 group-hover:rotate-45 group-hover:bg-brand-dark group-hover:text-white motion-reduce:group-hover:rotate-0">
                          <ArrowUpRight className="size-4" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </article>
              </Revelar>
            </li>
          ))}
        </ul>

        <Revelar className="mt-10">
          <aside
            aria-label="Projetos para a sua casa"
            className="relative isolate flex flex-col gap-6 overflow-hidden rounded-[1.75rem] bg-linear-to-br from-brand to-brand-dark p-7 text-white sm:p-10 lg:flex-row lg:items-center lg:justify-between"
          >
            <div aria-hidden="true" className="absolute -right-24 -bottom-24 -z-10 size-72 rounded-full border border-white/10" />
            <div aria-hidden="true" className="absolute -right-10 -bottom-10 -z-10 size-44 rounded-full border border-white/15" />
            <div className="flex items-start gap-5">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10 text-(--nova-acento-claro)">
                <House className="size-5" />
              </span>
              <p className="max-w-2xl text-lg leading-7 font-semibold tracking-tight sm:text-xl">
                Comprou seu lote? A ABA faz os projetos da sua casa — arquitetônico, elétrico e hidrossanitário.
              </p>
            </div>
            <Botao href={linkWhatsApp("Olá! Comprei um lote e quero os projetos da minha casa.", configuracoes.whatsapp)} externo variante="claro" icone="whatsapp" className="shrink-0 self-start lg:self-auto">
              Falar sobre o projeto
            </Botao>
          </aside>
        </Revelar>
      </div>
    </section>
  );
}
