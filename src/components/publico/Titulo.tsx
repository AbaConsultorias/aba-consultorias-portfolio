import { Fragment, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Revelar } from "./Revelar";

export const SERIF = "font-(family-name:--font-nova-serif) font-normal italic tracking-[-0.005em]";

export type ParteTitulo = string | { acento: string };

export function TextoMascarado({
  partes,
  tomAcento = "escuro",
}: {
  partes: readonly ParteTitulo[];
  tomAcento?: "escuro" | "claro";
}) {
  const palavras = partes.flatMap((parte) => {
    const acento = typeof parte !== "string";
    const texto = acento ? parte.acento : parte;
    return texto.split(/\s+/).filter(Boolean).map((palavra) => ({ palavra, acento }));
  });

  return palavras.map(({ palavra, acento }, indice) => (
    <Fragment key={indice}>
      {indice > 0 && " "}
      <span className="nova-mascara">
        <span
          style={{ "--i": indice } as CSSProperties}
          className={cn(
            "nova-palavra",
            acento && SERIF,
            acento && "pr-[0.06em] text-[1.08em] leading-none",
            acento && (tomAcento === "claro" ? "text-(--nova-acento-claro)" : "text-(--nova-acento)"),
          )}
        >
          {palavra}
        </span>
      </span>
    </Fragment>
  ));
}

export function Titulo({
  id,
  partes,
  className,
  tomAcento,
}: {
  id: string;
  partes: readonly ParteTitulo[];
  className?: string;
  tomAcento?: "escuro" | "claro";
}) {
  return (
    <Revelar efeito="palavras" className={className}>
      <h2
        id={id}
        className={cn(
          "text-[2.15rem] leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-[3.6rem]",
          tomAcento === "claro" ? "text-white" : "text-brand-dark",
        )}
      >
        <TextoMascarado partes={partes} tomAcento={tomAcento} />
      </h2>
    </Revelar>
  );
}
