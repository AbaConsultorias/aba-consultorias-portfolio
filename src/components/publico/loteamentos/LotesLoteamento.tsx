"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { Lote, StatusLote } from "@/lib/conteudo/tipos";
import { Botao } from "../Botao";
import { linkWhatsApp } from "../dados";
import { IconeWhatsApp } from "../Icones";
import { useMovimentoReduzido } from "../ganchos";
import { BadgeStatus } from "./BadgeStatus";
import { formatarArea, hrefInteresse, mensagemWhatsAppLote, ROTULO_STATUS } from "./lotes";
import { MapaLotes } from "./MapaLotes";

const TAMANHO_PAGINA = 40;
const EASE = [0.33, 1, 0.68, 1] as const;

type Filtro = "todos" | StatusLote;

const ORDEM_STATUS: StatusLote[] = ["disponivel", "vendido", "area_tecnica"];

const COLUNAS = "grid-cols-3 sm:grid-cols-[4.5rem_4.5rem_7rem_9rem_1fr]";

function Rotulo({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mb-0.5 block text-[10px] font-semibold tracking-[0.14em] text-[#526B78] uppercase sm:hidden">
      {children}
    </span>
  );
}

export function LotesLoteamento({
  slug,
  nomeLoteamento,
  lotes,
  mapaSvgUrl,
  whatsapp,
}: {
  slug: string;
  nomeLoteamento: string;
  lotes: Lote[];
  mapaSvgUrl: string | null;
  whatsapp: string | null;
}) {
  const reduzir = useMovimentoReduzido();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [limite, setLimite] = useState(TAMANHO_PAGINA);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const linhas = useRef(new Map<string, HTMLElement>());
  const origemMapa = useRef(false);

  const contagem = useMemo(() => {
    const total: Record<StatusLote, number> = { disponivel: 0, vendido: 0, area_tecnica: 0 };
    for (const lote of lotes) total[lote.status] += 1;
    return total;
  }, [lotes]);

  const filtrados = useMemo(() => (filtro === "todos" ? lotes : lotes.filter((lote) => lote.status === filtro)), [lotes, filtro]);
  const visiveis = filtrados.slice(0, limite);

  const selecionar = (id: string | null, doMapa: boolean) => {
    origemMapa.current = doMapa;
    setSelecionadoId(id);
    if (!id) return;
    const posicao = filtrados.findIndex((lote) => lote.id === id);
    if (posicao >= limite) setLimite(posicao + 1);
  };

  useEffect(() => {
    if (!selecionadoId || !origemMapa.current) return;
    linhas.current.get(selecionadoId)?.scrollIntoView({ block: "nearest", behavior: reduzir ? "auto" : "smooth" });
  }, [selecionadoId, reduzir, limite]);

  const trocarFiltro = (novo: Filtro) => {
    setFiltro(novo);
    setLimite(TAMANHO_PAGINA);
  };

  if (!lotes.length) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-brand/35 bg-white p-8 text-center sm:p-12">
        <p className="mx-auto max-w-md text-xl font-semibold tracking-tight text-brand-dark sm:text-2xl">Consulte os lotes disponíveis pelo WhatsApp</p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#526B78]">
          A lista deste loteamento ainda não está publicada aqui. A equipe informa quais lotes estão disponíveis, as medidas e as condições.
        </p>
        <div className="mt-7 flex justify-center">
          <Botao href={linkWhatsApp(`Olá! Quero saber quais lotes estão disponíveis no ${nomeLoteamento}.`, whatsapp)} externo variante="whatsapp" icone="whatsapp">
            Consultar pelo WhatsApp
          </Botao>
        </div>
      </div>
    );
  }

  const filtros: { valor: Filtro; rotulo: string; total: number }[] = [
    { valor: "todos", rotulo: "Todos", total: lotes.length },
    ...ORDEM_STATUS.map((status) => ({ valor: status, rotulo: status === "disponivel" ? "Disponíveis" : status === "vendido" ? "Vendidos" : ROTULO_STATUS[status], total: contagem[status] })),
  ];

  return (
    <div className="space-y-10">
      <dl className="grid grid-cols-3 gap-3 sm:gap-5">
        {[
          { rotulo: "Disponíveis", valor: contagem.disponivel, tom: "text-emerald-700" },
          { rotulo: "Vendidos", valor: contagem.vendido, tom: "text-red-700" },
          { rotulo: "Área técnica", valor: contagem.area_tecnica, tom: "text-slate-600" },
        ].map((item) => (
          <div key={item.rotulo} className="min-w-0 rounded-2xl border border-brand-dark/8 bg-white p-4 sm:p-6">
            <dt className="text-[11px] font-semibold tracking-[0.14em] text-[#526B78] uppercase sm:text-xs">{item.rotulo}</dt>
            <dd className={cn("mt-2 text-3xl font-semibold tracking-tight tabular-nums sm:text-5xl", item.tom)}>{item.valor}</dd>
          </div>
        ))}
      </dl>

      {mapaSvgUrl && (
        <MapaLotes
          mapaSvgUrl={mapaSvgUrl}
          slug={slug}
          nomeLoteamento={nomeLoteamento}
          lotes={lotes}
          selecionadoId={selecionadoId}
          onSelecionar={(id) => selecionar(id, true)}
        />
      )}

      <div>
        <fieldset className="min-w-0">
          <legend className="sr-only">Filtrar lotes por situação</legend>
          <div className="flex flex-wrap gap-2">
            {filtros.map(({ valor, rotulo, total }) => {
              const ativo = filtro === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={ativo}
                  aria-controls="lista-lotes"
                  onClick={() => trocarFiltro(valor)}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-semibold transition-[background-color,color,border-color] duration-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--nova-acento)",
                    ativo ? "border-brand-dark bg-brand-dark text-white" : "border-brand-dark/15 bg-white text-brand-dark hover:border-brand-dark/40",
                  )}
                >
                  {rotulo} <span className={cn("tabular-nums", ativo ? "text-white/70" : "text-[#526B78]")}>{total}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <p role="status" aria-live="polite" className="mt-4 text-sm text-[#526B78]">
          {filtrados.length} {filtrados.length === 1 ? "lote" : "lotes"}
          {filtro !== "todos" && ` · ${ROTULO_STATUS[filtro]}`}
        </p>

        <div id="lista-lotes" role="table" aria-label={`Lotes do loteamento ${nomeLoteamento}`} className="mt-3 overflow-hidden rounded-[1.5rem] border border-brand-dark/8 bg-white">
          <div role="rowgroup" className="sr-only sm:not-sr-only">
            <div role="row" className={cn("grid gap-x-3 border-b border-brand-dark/8 bg-(--nova-fundo) px-5 py-3 text-xs font-semibold tracking-[0.14em] text-[#526B78] uppercase", COLUNAS)}>
              <span role="columnheader">Quadra</span>
              <span role="columnheader">Lote</span>
              <span role="columnheader">Área</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Ação</span>
            </div>
          </div>
          <div role="rowgroup" className="relative">
            <AnimatePresence initial={false} mode="popLayout">
              {visiveis.map((lote) => {
                const ativo = lote.id === selecionadoId;
                return (
                  <motion.div
                    key={lote.id}
                    ref={(no: HTMLDivElement | null) => {
                      if (no) linhas.current.set(lote.id, no);
                      else linhas.current.delete(lote.id);
                    }}
                    layout={reduzir ? false : "position"}
                    initial={reduzir ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduzir ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    role="row"
                    aria-selected={ativo}
                    onClick={() => selecionar(ativo ? null : lote.id, false)}
                    className={cn(
                      "grid cursor-pointer items-center gap-x-3 gap-y-3 border-b border-brand-dark/6 px-4 py-4 text-sm last:border-b-0 sm:px-5 sm:py-3",
                      "transition-[background-color,box-shadow] duration-500 hover:bg-(--nova-fundo)",
                      ativo && "bg-[#e8f1f5] shadow-[inset_3px_0_0_var(--nova-acento)] hover:bg-[#e8f1f5]",
                      COLUNAS,
                    )}
                  >
                    <div role="cell" className="font-semibold text-brand-dark">
                      <Rotulo>Quadra</Rotulo>
                      {lote.quadra}
                    </div>
                    <div role="cell" className="font-semibold text-brand-dark">
                      <Rotulo>Lote</Rotulo>
                      {lote.numero}
                    </div>
                    <div role="cell" className="tabular-nums text-brand-dark/85">
                      <Rotulo>Área</Rotulo>
                      {formatarArea(lote.areaM2)}
                    </div>
                    <div role="cell" className="sm:col-span-1">
                      <BadgeStatus status={lote.status} />
                    </div>
                    <div role="cell" className="col-span-2 flex flex-wrap items-center justify-end gap-x-4 sm:col-span-1 sm:justify-start">
                      {lote.status === "disponivel" ? (
                        <>
                          <Link
                            href={hrefInteresse(slug, lote)}
                            onClick={(evento) => evento.stopPropagation()}
                            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-(--nova-acento)"
                          >
                            Tenho interesse
                          </Link>
                          <a
                            href={linkWhatsApp(mensagemWhatsAppLote(nomeLoteamento, lote), whatsapp)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(evento) => evento.stopPropagation()}
                            aria-label={`Perguntar sobre a quadra ${lote.quadra}, lote ${lote.numero}, pelo WhatsApp (abre em nova aba)`}
                            className="grid size-11 place-items-center rounded-full text-(--nova-whatsapp) transition-colors duration-300 hover:bg-(--nova-whatsapp)/10 focus-visible:outline-2 focus-visible:outline-(--nova-acento)"
                          >
                            <IconeWhatsApp className="size-5" />
                          </a>
                        </>
                      ) : (
                        <span aria-hidden="true" className="text-[#526B78]">—</span>
                      )}
                      {lote.observacao && <p className="basis-full text-xs leading-5 text-[#526B78] sm:basis-auto sm:max-w-48">{lote.observacao}</p>}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
          {!visiveis.length && <p className="px-5 py-10 text-center text-sm text-[#526B78]">Nenhum lote com esta situação.</p>}
        </div>

        {filtrados.length > visiveis.length && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setLimite((atual) => atual + TAMANHO_PAGINA)}
              className="min-h-12 rounded-full border border-brand-dark/20 px-6 text-sm font-semibold text-brand-dark transition-[background-color,color] duration-500 hover:bg-brand-dark hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--nova-acento)"
            >
              Mostrar mais lotes ({filtrados.length - visiveis.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
