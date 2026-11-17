import Image from "next/image";
import { cn } from "@/lib/utils";

const TEXTO = "ABA CONSULTORIA · PROJETOS · LOTEAMENTOS · ";
const RAIO = 76;

export function SeloGiratorio({ id, className }: { id: string; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative grid size-32 place-items-center rounded-full bg-white shadow-[0_20px_50px_-20px_rgba(28,40,50,0.5)] sm:size-40", className)}>
      <svg viewBox="0 0 200 200" className="nova-girar absolute inset-0 size-full text-brand-dark">
        <defs>
          <path id={id} d={`M100,100 m-${RAIO},0 a${RAIO},${RAIO} 0 1,1 ${RAIO * 2},0 a${RAIO},${RAIO} 0 1,1 -${RAIO * 2},0`} />
        </defs>
        <text className="fill-current text-[13px] font-semibold uppercase">
          <textPath href={`#${id}`} textLength={2 * Math.PI * RAIO - 4} lengthAdjust="spacing">
            {TEXTO}
          </textPath>
        </text>
      </svg>
      <div className="relative aspect-[1131/900] w-[44%]">
        <Image src="/marca/aba-logo.png" alt="" fill sizes="80px" className="object-cover object-top" />
      </div>
    </div>
  );
}
