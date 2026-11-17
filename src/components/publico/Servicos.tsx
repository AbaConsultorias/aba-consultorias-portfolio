import type { Servico } from "@/lib/conteudo/tipos";
import { LinhaCurva } from "./LinhaCurva";
import { ListaServicos } from "./ListaServicos";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

export function Servicos({ servicos }: { servicos: Servico[] }) {
  if (!servicos.length) return null;
  return (
    <section id="servicos" aria-labelledby="servicos-titulo" className="relative isolate scroll-mt-24 py-24 sm:py-32">
      <LinhaCurva className="top-10 text-(--nova-acento)/25" />
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Sobrancelha numero="01" texto="Para loteadores" />
        <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-10">
          <Titulo
            id="servicos-titulo"
            className="lg:col-span-8"
            partes={["Tudo o que o seu loteamento precisa para ser", { acento: "aprovado." }]}
          />
          <Revelar atraso={200} className="lg:col-span-4">
            <p className="max-w-md text-base leading-7 text-[#526B78]">
              Da viabilidade à rede pronta, uma equipe só cuida de cada etapa junto à Copasa ou à concessionária que atende o seu empreendimento.
            </p>
          </Revelar>
        </div>
        <ListaServicos servicos={servicos} />
      </div>
    </section>
  );
}
