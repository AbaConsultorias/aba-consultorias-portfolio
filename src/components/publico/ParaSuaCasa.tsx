import type { Servico, Configuracoes } from "@/lib/conteudo/tipos";
import { DraftingCompass, Droplets, PlugZap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Botao } from "./Botao";
import { linkWhatsApp } from "./dados";
import Link from "next/link";
import { DesenhoTecnico } from "./DesenhoTecnico";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

const ICONES: Record<string, LucideIcon> = {
  arquitetonico: DraftingCompass,
  eletrico: PlugZap,
  hidrossanitario: Droplets,
};

const GRADE_TECNICA = {
  backgroundImage:
    "linear-gradient(rgba(140,196,220,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(140,196,220,0.09) 1px, transparent 1px), linear-gradient(rgba(140,196,220,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(140,196,220,0.045) 1px, transparent 1px)",
  backgroundSize: "80px 80px, 80px 80px, 16px 16px, 16px 16px",
};

export function ParaSuaCasa({ servicos, configuracoes }: { servicos: Servico[]; configuracoes: Configuracoes }) {
  if (!servicos.length) return null;
  return (
    <section aria-labelledby="casa-titulo" className="px-2 sm:px-3">
      <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-brand-dark py-24 text-white sm:rounded-[2.5rem] sm:py-32">
        <div aria-hidden="true" style={GRADE_TECNICA} className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_70%_20%,black_20%,transparent_75%)]" />
        <div aria-hidden="true" className="absolute -top-40 -right-40 -z-10 size-[36rem] rounded-full bg-(--nova-acento)/25 blur-3xl" />

        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Sobrancelha numero="02" texto="Para sua casa" tom="claro" />
          <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-10">
            <Titulo
              id="casa-titulo"
              tomAcento="claro"
              className="lg:col-span-8"
              partes={["Do lote à casa pronta: os projetos da sua construção", { acento: "também com a ABA." }]}
            />
            <Revelar atraso={200} className="lg:col-span-4">
              <p className="max-w-md text-base leading-7 text-white/80">
                Além dos loteamentos, a nossa equipe faz os projetos de quem vai construir, com o mesmo cuidado técnico e acompanhamento de perto.
              </p>
            </Revelar>
          </div>

          <ul className="mt-14 grid gap-5 md:grid-cols-3 lg:mt-20">
            {servicos.map((projeto, indice) => {
              const Icone = ICONES[projeto.icone ?? ""] ?? DraftingCompass;
              return (
                <li key={projeto.titulo} className="min-w-0">
                  <Revelar atraso={indice * 140} className="h-full">
                    <article
                      className={cn(
                        "group flex h-full flex-col rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm sm:p-7",
                        "transition-[translate,background-color,border-color,box-shadow] duration-500 hover:-translate-y-2 hover:border-white/25 hover:bg-white/[0.07] hover:shadow-[0_30px_60px_-30px_rgba(0,0,0,0.6)]",
                        "motion-reduce:hover:translate-y-0",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="grid size-12 place-items-center rounded-full border border-white/15 bg-white/5 text-(--nova-acento-claro) transition-[background-color,color,rotate] duration-500 group-hover:-rotate-12 group-hover:bg-(--nova-acento-claro) group-hover:text-brand-dark motion-reduce:group-hover:rotate-0">
                          <Icone aria-hidden="true" className="size-5" />
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-white/60">0{indice + 1}</span>
                      </div>
                      <div style={GRADE_TECNICA} className="mt-6 rounded-2xl border border-white/10 bg-[#223140] px-4 pt-5 pb-3">
                        <DesenhoTecnico desenho={projeto.icone} />
                      </div>
                      <h3 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl"><Link href={`/servicos/${projeto.slug}`} className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{projeto.titulo}</Link></h3>
                      <p className="mt-3 text-sm leading-6 text-white/75">{projeto.resumo}</p>
                      <ul className="mt-5 space-y-2 border-t border-white/10 pt-5 text-sm text-white/85">
                        {projeto.itens.map((item) => (
                          <li key={item} className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="h-px w-4 bg-(--nova-acento-claro)" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </article>
                  </Revelar>
                </li>
              );
            })}
          </ul>

          <Revelar className="mt-12 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-lg text-sm leading-6 text-white/75">
              Arquitetônico, elétrico e hidrossanitário: os três projetos da casa com a mesma equipe, conversando entre si desde o começo.
            </p>
            <Botao href={linkWhatsApp("Olá! Quero o projeto da minha casa com a ABA.", configuracoes.whatsapp)} externo variante="claro" icone="whatsapp">
              Quero o projeto da minha casa
            </Botao>
          </Revelar>
        </div>
      </div>
    </section>
  );
}
