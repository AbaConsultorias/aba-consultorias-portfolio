import type { VideoInstagram, Configuracoes } from "@/lib/conteudo/tipos";
import { cn } from "@/lib/utils";
import { Botao } from "./Botao";

import { LinhaCurva } from "./LinhaCurva";
import { Reel } from "./Reel";
import { Revelar } from "./Revelar";
import { Sobrancelha } from "./Sobrancelha";
import { Titulo } from "./Titulo";

export function Instagram({ videos, configuracoes }: { videos: VideoInstagram[]; configuracoes: Configuracoes }) {
  if (!videos.length) return null;
  return (
    <section aria-labelledby="instagram-titulo" className="relative isolate py-24 sm:py-32">
      <LinhaCurva tracado="laco" className="top-24 text-(--nova-acento)/20" />
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Sobrancelha numero="04" texto="No Instagram" />
        <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <Titulo id="instagram-titulo" className="max-w-3xl" partes={["A equipe ABA", { acento: "no dia a dia." }]} />
          <Revelar atraso={200}>
            {configuracoes.instagramUrl && <Botao href={configuracoes.instagramUrl} externo variante="escuro" icone="instagram">
              Seguir {configuracoes.instagramUsuario ? `@${configuracoes.instagramUsuario.replace(/^@/, "")}` : "no Instagram"}
            </Botao>}
          </Revelar>
        </div>
      </div>

      <ul className="mx-auto mt-12 flex max-w-7xl snap-x snap-mandatory scroll-ps-5 gap-4 overflow-x-auto px-5 pt-3 pb-6 [scrollbar-width:none] sm:scroll-ps-8 sm:px-8 lg:mt-16 lg:grid lg:grid-cols-5 lg:gap-5 lg:overflow-visible [&::-webkit-scrollbar]:hidden">
        {videos.map((reel, indice) => (
          <li key={reel.id} className={cn("w-[62vw] max-w-72 shrink-0 snap-start sm:w-[40vw] lg:w-auto lg:max-w-none", indice % 2 === 1 && "lg:translate-y-10")}>
            <Revelar atraso={indice * 110}>
              <Reel video={reel} numero={indice + 1} total={videos.length} configuracoes={configuracoes} />
            </Revelar>
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-6 max-w-7xl px-5 text-xs text-[#526B78] sm:px-8 lg:mt-14">
        Os vídeos tocam sem som e se repetem. Toque em um vídeo para pausar.
      </p>
    </section>
  );
}
