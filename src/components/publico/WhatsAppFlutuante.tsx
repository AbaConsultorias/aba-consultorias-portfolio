import type { Configuracoes } from "@/lib/conteudo/tipos";
import type { CSSProperties } from "react";
import { linkWhatsApp } from "./dados";
import { IconeWhatsApp } from "./Icones";

export function WhatsAppFlutuante({ configuracoes }: { configuracoes: Configuracoes }) {
  return (
    <a
      href={linkWhatsApp("Olá! Vim pelo site da ABA.", configuracoes.whatsapp)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ "--atraso": "1800ms" } as CSSProperties}
      className="nova-surgir group fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center rounded-full bg-(--nova-whatsapp) text-white shadow-[0_18px_40px_-14px_rgba(27,138,75,0.7)] transition-[background-color,box-shadow] duration-500 hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento) sm:right-6 sm:bottom-6"
    >
      <span aria-hidden="true" className="nova-pulso absolute inset-0 -z-10 rounded-full bg-(--nova-whatsapp)" />
      <span className="grid size-14 place-items-center">
        <IconeWhatsApp className="size-7" />
      </span>
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-500 group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]">
        <span className="overflow-hidden text-sm font-semibold whitespace-nowrap">
          <span className="block pr-5">Fale com a ABA</span>
        </span>
      </span>
      <span className="sr-only"> pelo WhatsApp (abre em nova aba)</span>
    </a>
  );
}
