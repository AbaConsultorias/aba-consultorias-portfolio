import type { Configuracoes } from "@/lib/conteudo/tipos";
import { Botao } from "./Botao";
import { linkWhatsApp, PASSOS } from "./dados";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

export function ComoComecar({ configuracoes, numero = "08" }: { configuracoes: Configuracoes; numero?: string }) {
  return (
    <section aria-labelledby="comecar-titulo" className="px-2 sm:px-3">
      <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-brand-dark py-24 text-white sm:rounded-[2.5rem] sm:py-32">
        <div aria-hidden="true" className="absolute -bottom-48 -left-40 -z-10 size-[34rem] rounded-full bg-(--nova-acento)/30 blur-3xl" />
        <div aria-hidden="true" className="absolute top-0 right-0 -z-10 size-[30rem] translate-x-1/3 -translate-y-1/3 rounded-full border border-white/8" />
        <div aria-hidden="true" className="absolute top-0 right-0 -z-10 size-[20rem] translate-x-1/4 -translate-y-1/4 rounded-full border border-white/10" />

        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Sobrancelha numero={numero} texto="Como começar" tom="claro" />
          <Titulo
            id="comecar-titulo"
            tomAcento="claro"
            className="mt-8 max-w-4xl"
            partes={["Seu próximo passo", { acento: "começa com uma conversa." }]}
          />

          <Revelar efeito="gatilho" className="relative mt-16 lg:mt-20">
            <span aria-hidden="true" className="nova-linha absolute top-7 right-[16%] left-[16%] hidden h-px bg-white/25 md:block" />
            <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
              {PASSOS.map((passo, indice) => (
                <li key={passo.titulo} className="md:text-center">
                  <Revelar atraso={indice * 180} className="flex gap-5 md:flex-col md:items-center">
                    <span className="grid size-14 shrink-0 place-items-center rounded-full border border-white/25 bg-brand-dark text-sm font-semibold tabular-nums text-(--nova-acento-claro) shadow-[0_0_0_8px_var(--color-brand-dark)]">
                      0{indice + 1}
                    </span>
                    <div>
                      <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{passo.titulo}</h3>
                      <p className="mt-3 text-sm leading-6 text-white/75 md:mx-auto md:max-w-xs">{passo.texto}</p>
                    </div>
                  </Revelar>
                </li>
              ))}
            </ol>
          </Revelar>

          <Revelar className="mt-16 flex flex-col items-start gap-6 border-t border-white/15 pt-10 sm:flex-row sm:items-center sm:justify-between lg:mt-20">
            <p className="max-w-md text-base leading-7 text-white/80">
              Atendemos loteamentos de qualquer porte, onde eles estiverem. Conte o que você precisa e a equipe responde pelo WhatsApp.
            </p>
            <Botao href={linkWhatsApp("Olá! Quero começar um projeto com a ABA.", configuracoes.whatsapp)} externo variante="whatsapp" icone="whatsapp" grande>
              Chamar a ABA no WhatsApp
            </Botao>
          </Revelar>
        </div>
      </div>
    </section>
  );
}
