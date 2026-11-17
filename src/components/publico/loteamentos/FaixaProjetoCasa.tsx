import { DraftingCompass, Droplets, House, PlugZap } from "lucide-react";
import type { Configuracoes } from "@/lib/conteudo/tipos";
import { Botao } from "../Botao";
import { linkWhatsApp } from "../dados";
import { Revelar } from "../Revelar";

const DISCIPLINAS = [
  { rotulo: "Arquitetônico", Icone: DraftingCompass },
  { rotulo: "Elétrico", Icone: PlugZap },
  { rotulo: "Hidrossanitário", Icone: Droplets },
] as const;

export function FaixaProjetoCasa({ configuracoes, nomeLoteamento }: { configuracoes: Configuracoes; nomeLoteamento?: string }) {
  const mensagem = nomeLoteamento
    ? `Olá! Comprei um lote no ${nomeLoteamento} e quero os projetos da minha casa.`
    : "Olá! Comprei um lote e quero os projetos da minha casa.";

  return (
    <section aria-labelledby="faixa-casa-titulo" className="px-2 sm:px-3">
      <Revelar>
        <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-linear-to-br from-brand to-brand-dark py-14 text-white sm:rounded-[2.5rem] sm:py-20">
          <div aria-hidden="true" className="absolute -right-24 -bottom-24 -z-10 size-96 rounded-full border border-white/10" />
          <div aria-hidden="true" className="absolute -right-10 -bottom-10 -z-10 size-60 rounded-full border border-white/15" />

          <div className="mx-auto flex max-w-7xl flex-col gap-10 px-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 max-w-2xl">
              <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-white/10 text-(--nova-acento-claro)">
                <House className="size-5" />
              </span>
              <h2 id="faixa-casa-titulo" className="mt-6 text-3xl leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
                Comprou seu lote? A ABA faz os projetos da sua casa.
              </h2>
              <ul className="mt-6 flex flex-wrap gap-2">
                {DISCIPLINAS.map(({ rotulo, Icone }) => (
                  <li key={rotulo} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 py-2 text-sm font-medium">
                    <Icone aria-hidden="true" className="size-4 text-(--nova-acento-claro)" />
                    {rotulo}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row lg:flex-col lg:items-stretch">
              <Botao href={linkWhatsApp(mensagem, configuracoes.whatsapp)} externo variante="claro" icone="whatsapp">
                Falar sobre o projeto
              </Botao>
              <Botao href="/servicos" variante="contorno-claro">
                Conhecer os serviços
              </Botao>
            </div>
          </div>
        </div>
      </Revelar>
    </section>
  );
}
