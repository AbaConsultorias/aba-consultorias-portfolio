import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconeInstagram, IconeWhatsApp } from "./Icones";

const VARIANTES = {
  escuro: {
    base: "bg-brand-dark text-white",
    preenchimento: "bg-(--nova-acento)",
    texto: "",
    circulo: "bg-white/15",
  },
  claro: {
    base: "bg-white text-brand-dark",
    preenchimento: "bg-(--nova-acento-claro)",
    texto: "",
    circulo: "bg-brand-dark text-white",
  },
  contorno: {
    base: "border border-brand-dark/20 text-brand-dark",
    preenchimento: "bg-brand-dark",
    texto: "group-hover/botao:text-white group-focus-visible/botao:text-white",
    circulo: "bg-brand-dark/8 group-hover/botao:bg-white/15",
  },
  "contorno-claro": {
    base: "border border-white/45 text-white backdrop-blur-sm",
    preenchimento: "bg-white",
    texto: "group-hover/botao:text-brand-dark group-focus-visible/botao:text-brand-dark",
    circulo: "bg-white/15 group-hover/botao:bg-brand-dark/10",
  },
  whatsapp: {
    base: "bg-(--nova-whatsapp) text-white",
    preenchimento: "bg-brand-dark",
    texto: "",
    circulo: "bg-white/15",
  },
} as const;

type Variante = keyof typeof VARIANTES;

export function Botao({
  href,
  children,
  variante = "escuro",
  icone,
  externo = false,
  grande = false,
  className,
}: {
  href: string;
  children: ReactNode;
  variante?: Variante;
  icone?: "whatsapp" | "instagram";
  externo?: boolean;
  grande?: boolean;
  className?: string;
}) {
  const estilo = VARIANTES[variante];
  const conteudo = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 -z-10 origin-bottom scale-y-0 rounded-[inherit] transition-[scale,opacity] duration-500 group-hover/botao:scale-y-100 group-focus-visible/botao:scale-y-100",
          "motion-reduce:scale-y-100 motion-reduce:opacity-0 motion-reduce:group-hover/botao:opacity-100 motion-reduce:group-focus-visible/botao:opacity-100",
          estilo.preenchimento,
        )}
      />
      {icone === "whatsapp" && <IconeWhatsApp className={cn("shrink-0", grande ? "size-6" : "size-5")} />}
      {icone === "instagram" && <IconeInstagram className={cn("shrink-0", grande ? "size-6" : "size-5")} />}
      <span className={cn("transition-colors duration-500", estilo.texto)}>{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-full transition-colors duration-500",
          grande ? "size-10" : "size-8",
          estilo.circulo,
        )}
      >
        <ArrowUpRight
          className={cn(
            "size-4 transition-[translate] duration-500 group-hover/botao:translate-x-6 group-hover/botao:-translate-y-6",
            "motion-reduce:group-hover/botao:translate-x-0 motion-reduce:group-hover/botao:translate-y-0",
          )}
        />
        <ArrowUpRight
          className={cn(
            "absolute size-4 -translate-x-6 translate-y-6 transition-[translate] duration-500 group-hover/botao:translate-x-0 group-hover/botao:translate-y-0",
            "motion-reduce:hidden",
          )}
        />
      </span>
      {externo && <span className="sr-only"> (abre em nova aba)</span>}
    </>
  );

  const classes = cn(
    "group/botao relative isolate inline-flex max-w-full items-center justify-between gap-3 overflow-hidden rounded-full font-semibold",
    "transition-[color,box-shadow,background-color] duration-500 hover:shadow-[0_14px_34px_-14px_rgba(28,40,50,0.55)]",
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)",
    grande ? "min-h-16 py-3 pr-3 pl-7 text-base sm:text-lg" : "min-h-12 py-2 pr-2 pl-5 text-sm",
    estilo.base,
    className,
  );

  if (externo) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {conteudo}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {conteudo}
    </Link>
  );
}
