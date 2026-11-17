import type { ProjetoResumo } from "@/lib/conteudo/tipos";
import { Botao } from "./Botao";
import { CarrosselProjetos } from "./CarrosselProjetos";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

export function ProjetosRealizados({ projetos }: { projetos: ProjetoResumo[] }) {
  if (!projetos.length) return null;
  return (
    <section aria-labelledby="projetos-titulo" className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Sobrancelha numero="03" texto="Projetos realizados" />
        <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-10">
          <Titulo
            id="projetos-titulo"
            className="lg:col-span-8"
            partes={["Infraestrutura entregue,", { acento: "loteamento por loteamento." }]}
          />
          <Revelar atraso={200} className="lg:col-span-4">
            <p className="max-w-md text-base leading-7 text-[#526B78]">
              Redes de água e esgoto projetadas, aprovadas e executadas pela equipe da ABA em loteamentos de diferentes cidades.
            </p>
          </Revelar>
        </div>
      </div>

      <Revelar className="mt-12 lg:mt-16">
        <CarrosselProjetos projetos={projetos} />
      </Revelar>

      <div className="mx-auto mt-10 max-w-7xl px-5 sm:px-8">
        <Botao href="/projetos" variante="contorno">
          Ver todos os projetos
        </Botao>
      </div>
    </section>
  );
}
