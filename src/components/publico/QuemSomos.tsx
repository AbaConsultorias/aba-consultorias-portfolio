import type { Configuracoes, LoteamentoResumo } from "@/lib/conteudo/tipos";
import { Botao } from "./Botao";

import { FotoParallax } from "./FotoParallax";
import { Revelar } from "./Revelar";
import { SeloGiratorio } from "./SeloGiratorio";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

const PUBLICO = ["Loteadores", "Investidores", "Proprietários de terrenos"] as const;

export function QuemSomos({ configuracoes, loteamento }: { configuracoes: Configuracoes; loteamento?: LoteamentoResumo }) {
  const fotoUrl = loteamento?.capaUrl ?? loteamento?.bannerUrl;
  return (
    <section aria-labelledby="sobre-titulo" className="bg-white py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-2 lg:items-center lg:gap-20">
        <Revelar className="relative pb-10 lg:pb-0">
          {fotoUrl && <FotoParallax
            src={fotoUrl}
            alt={loteamento?.nome ?? "ABA Consultoria"}
            sizes="(min-width: 1280px) 592px, (min-width: 1024px) 46vw, 92vw"
            intensidade={10}
            className="aspect-[4/5] rounded-[2rem] sm:aspect-[5/4] lg:aspect-[4/5]"
          />}
          <div className="absolute -bottom-2 left-5 sm:left-8 lg:-right-10 lg:bottom-10 lg:left-auto">
            <SeloGiratorio id="selo-sobre" />
          </div>
        </Revelar>

        <div>
          <Sobrancelha numero="07" texto="Quem somos" />
          <Titulo id="sobre-titulo" className="mt-8" partes={configuracoes.sobreTitulo ? [configuracoes.sobreTitulo] : ["Quem projeta", { acento: "também executa." }]} />
          <Revelar atraso={150} className="mt-8 space-y-5 text-base leading-7 text-[#526B78] sm:text-lg sm:leading-8">
            {configuracoes.sobreTexto ? <p className="whitespace-pre-line">{configuracoes.sobreTexto}</p> : <>
            <p>
              A ABA Consultoria faz consultoria, regularização e projetos de infraestrutura de água e esgoto para loteamentos, e também os projetos de quem vai construir a própria casa.
            </p>
            <p>
              Com equipe própria do projeto à execução, acompanhamos cada etapa de perto, sem repassar o seu empreendimento de mão em mão.
            </p>
            </>}
          </Revelar>
          <Revelar atraso={250} className="mt-10">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-[#526B78] uppercase sm:text-xs">Quem atendemos</p>
            <ul className="mt-4 border-t border-brand-dark/10">
              {PUBLICO.map((publico, indice) => (
                <li key={publico} className="group flex items-center justify-between border-b border-brand-dark/10 py-4">
                  <span className="text-lg font-semibold tracking-tight text-brand-dark transition-[translate,color] duration-500 group-hover:translate-x-2 group-hover:text-(--nova-acento) motion-reduce:group-hover:translate-x-0 sm:text-xl">
                    {publico}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-[#526B78]">0{indice + 1}</span>
                </li>
              ))}
            </ul>
          </Revelar>
          <Revelar atraso={350} className="mt-10">
            <Botao href="/sobre" variante="escuro">
              Conheça a ABA
            </Botao>
          </Revelar>
        </div>
      </div>
    </section>
  );
}
