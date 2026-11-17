"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import type { Lote, StatusLote } from "@/lib/conteudo/tipos";
import { useMovimentoReduzido } from "../ganchos";
import { BadgeStatus } from "./BadgeStatus";
import { formatarArea, hrefInteresse, identificarLote, ROTULO_STATUS } from "./lotes";
import "./mapa.css";

const ZOOM_MAXIMO = 6;
const LIMITE_ARQUIVO = 2_000_000;
const LIMITE_ARRASTE = 4;

type Vista = { x: number; y: number; k: number };
type Carga = { estado: "carregando" } | { estado: "erro" } | { estado: "pronto"; html: string };
type Dica = { lote: Lote; x: number; y: number };

const LEGENDA: { status: StatusLote; cor: string }[] = [
  { status: "disponivel", cor: "bg-[#2f9e63]" },
  { status: "vendido", cor: "bg-[#d4574f]" },
  { status: "area_tecnica", cor: "bg-[#9aa5ae]" },
];

function limitar(valor: number, minimo: number, maximo: number) {
  return Math.min(maximo, Math.max(minimo, valor));
}

function rotuloDoLote(lote: Lote) {
  return `${identificarLote(lote)}, ${formatarArea(lote.areaM2)}, ${ROTULO_STATUS[lote.status]}`;
}

function BotaoMapa({ rotulo, desligado, onClick, children }: { rotulo: string; desligado: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desligado}
      aria-label={rotulo}
      className="grid size-11 place-items-center rounded-full border border-brand-dark/10 bg-white/95 text-brand-dark shadow-[0_10px_24px_-14px_rgba(28,40,50,0.6)] transition-[background-color,color,opacity] duration-300 hover:bg-brand-dark hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--nova-acento) disabled:opacity-40 disabled:hover:bg-white/95 disabled:hover:text-brand-dark"
    >
      {children}
    </button>
  );
}

export function MapaLotes({
  mapaSvgUrl,
  slug,
  nomeLoteamento,
  lotes,
  selecionadoId,
  onSelecionar,
}: {
  mapaSvgUrl: string;
  slug: string;
  nomeLoteamento: string;
  lotes: Lote[];
  selecionadoId: string | null;
  onSelecionar: (id: string | null) => void;
}) {
  const reduzir = useMovimentoReduzido();
  const [carga, setCarga] = useState<Carga>({ estado: "carregando" });
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, k: 1 });
  const [gesto, setGesto] = useState(false);
  const [dica, setDica] = useState<Dica | null>(null);
  const moldura = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const vistaAtual = useRef(vista);
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const inicioArraste = useRef<{ x: number; y: number } | null>(null);
  const arrastou = useRef(false);
  const distanciaPinca = useRef(0);

  const lotesPorId = useMemo(() => new Map(lotes.map((lote) => [lote.id, lote])), [lotes]);
  const selecionado = selecionadoId ? (lotesPorId.get(selecionadoId) ?? null) : null;

  useEffect(() => {
    const controle = new AbortController();
    (async () => {
      try {
        const resposta = await fetch(mapaSvgUrl, { signal: controle.signal });
        if (!resposta.ok) throw new Error("resposta inválida");
        const texto = await resposta.text();
        if (texto.length > LIMITE_ARQUIVO || !texto.includes("<svg")) throw new Error("arquivo inválido");
        // Import sob demanda: o limpador (DOMPurify) só entra quando há mapa. O
        // resultado vai direto para o estado que o JSX injeta, sem outro passo.
        const { sanitizarSvg } = await import("@/lib/svg/sanitizar");
        const html = sanitizarSvg(texto, { responsivo: true });
        if (!html) throw new Error("mapa vazio");
        setCarga({ estado: "pronto", html });
      } catch {
        if (!controle.signal.aborted) setCarga({ estado: "erro" });
      }
    })();
    return () => controle.abort();
  }, [mapaSvgUrl]);

  useEffect(() => {
    if (carga.estado !== "pronto" || !conteudo.current) return;
    const porId = new Map<string, Element>();
    for (const elemento of conteudo.current.querySelectorAll("[id]")) porId.set(elemento.id, elemento);

    for (const lote of lotes) {
      const elemento = lote.svgId ? porId.get(lote.svgId) : undefined;
      if (!elemento) continue;
      elemento.setAttribute("data-status", lote.status);
      elemento.setAttribute("data-lote", lote.id);
      elemento.setAttribute("aria-label", rotuloDoLote(lote));
      if (lote.status === "disponivel") {
        elemento.setAttribute("role", "button");
        elemento.setAttribute("tabindex", "0");
      } else {
        elemento.setAttribute("role", "img");
      }
    }
  }, [carga, lotes]);

  const aplicar = useCallback((proxima: Vista) => {
    const quadro = moldura.current;
    const k = limitar(proxima.k, 1, ZOOM_MAXIMO);
    const largura = quadro?.clientWidth ?? 0;
    const altura = quadro?.clientHeight ?? 0;
    const final = {
      k,
      x: limitar(proxima.x, -(k - 1) * largura, 0),
      y: limitar(proxima.y, -(k - 1) * altura, 0),
    };
    vistaAtual.current = final;
    setVista(final);
  }, []);

  const ampliarEm = useCallback(
    (fator: number, cx: number, cy: number) => {
      const { x, y, k } = vistaAtual.current;
      const novoK = limitar(k * fator, 1, ZOOM_MAXIMO);
      const razao = novoK / k;
      aplicar({ k: novoK, x: cx - (cx - x) * razao, y: cy - (cy - y) * razao });
    },
    [aplicar],
  );

  const ampliarNoCentro = (fator: number) => {
    const quadro = moldura.current;
    if (quadro) ampliarEm(fator, quadro.clientWidth / 2, quadro.clientHeight / 2);
  };

  const trazerParaVista = useCallback(
    (elemento: Element) => {
      const quadro = moldura.current;
      if (!quadro) return;
      quadro.scrollTo(0, 0);
      const area = quadro.getBoundingClientRect();
      const caixa = elemento.getBoundingClientRect();
      const dentro = caixa.left >= area.left && caixa.right <= area.right && caixa.top >= area.top && caixa.bottom <= area.bottom;
      if (dentro) return;
      const { x, y, k } = vistaAtual.current;
      aplicar({
        k,
        x: x + (area.left + area.width / 2 - (caixa.left + caixa.width / 2)),
        y: y + (area.top + area.height / 2 - (caixa.top + caixa.height / 2)),
      });
    },
    [aplicar],
  );

  useEffect(() => {
    const raiz = conteudo.current;
    if (!raiz || carga.estado !== "pronto") return;
    let alvo: Element | null = null;
    for (const elemento of raiz.querySelectorAll("[data-lote]")) {
      const ativo = elemento.getAttribute("data-lote") === selecionadoId;
      elemento.toggleAttribute("data-selecionado", ativo);
      if (ativo) alvo = elemento;
    }
    if (alvo) trazerParaVista(alvo);
  }, [carga, selecionadoId, trazerParaVista]);

  useEffect(() => {
    const quadro = moldura.current;
    if (!quadro) return;
    const aoRolar = (evento: WheelEvent) => {
      if (!evento.ctrlKey && !evento.metaKey) return;
      evento.preventDefault();
      const caixa = quadro.getBoundingClientRect();
      ampliarEm(Math.exp(-evento.deltaY * 0.01), evento.clientX - caixa.left, evento.clientY - caixa.top);
    };
    quadro.addEventListener("wheel", aoRolar, { passive: false });
    return () => quadro.removeEventListener("wheel", aoRolar);
  }, [ampliarEm]);

  const loteDoAlvo = (alvo: EventTarget | null) => {
    const id = (alvo as Element | null)?.closest?.("[data-lote]")?.getAttribute("data-lote");
    return id ? (lotesPorId.get(id) ?? null) : null;
  };

  const aoApertar = (evento: PointerEvent<HTMLDivElement>) => {
    ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    if (ponteiros.current.size === 1) {
      inicioArraste.current = { x: evento.clientX, y: evento.clientY };
      arrastou.current = false;
      return;
    }
    const [a, b] = [...ponteiros.current.values()];
    distanciaPinca.current = Math.hypot(a.x - b.x, a.y - b.y);
    arrastou.current = true;
    setGesto(true);
  };

  const aoMover = (evento: PointerEvent<HTMLDivElement>) => {
    const quadro = moldura.current;
    const anterior = ponteiros.current.get(evento.pointerId);
    if (!quadro) return;

    if (!anterior) {
      if (evento.pointerType !== "mouse") return;
      const lote = loteDoAlvo(evento.target);
      const caixa = quadro.getBoundingClientRect();
      setDica(lote ? { lote, x: evento.clientX - caixa.left, y: evento.clientY - caixa.top } : null);
      return;
    }

    const atual = { x: evento.clientX, y: evento.clientY };
    ponteiros.current.set(evento.pointerId, atual);
    const caixa = quadro.getBoundingClientRect();

    if (ponteiros.current.size >= 2) {
      const [a, b] = [...ponteiros.current.values()];
      const distancia = Math.hypot(a.x - b.x, a.y - b.y);
      if (distanciaPinca.current > 0) {
        ampliarEm(distancia / distanciaPinca.current, (a.x + b.x) / 2 - caixa.left, (a.y + b.y) / 2 - caixa.top);
      }
      distanciaPinca.current = distancia;
      return;
    }

    const inicio = inicioArraste.current;
    if (!inicio || vistaAtual.current.k === 1) return;
    if (!arrastou.current) {
      if (Math.hypot(atual.x - inicio.x, atual.y - inicio.y) < LIMITE_ARRASTE) return;
      arrastou.current = true;
      quadro.setPointerCapture(evento.pointerId);
      setGesto(true);
      setDica(null);
    }
    const { x, y, k } = vistaAtual.current;
    aplicar({ k, x: x + atual.x - anterior.x, y: y + atual.y - anterior.y });
  };

  const aoSoltar = (evento: PointerEvent<HTMLDivElement>) => {
    ponteiros.current.delete(evento.pointerId);
    distanciaPinca.current = 0;
    if (ponteiros.current.size > 0) return;
    inicioArraste.current = null;
    setGesto(false);
    // O click vem logo depois do pointerup; só então a marca de arraste pode cair.
    setTimeout(() => {
      arrastou.current = false;
    }, 0);
  };

  const alternarSelecao = (lote: Lote) => onSelecionar(lote.id === selecionadoId ? null : lote.id);

  const aoClicar = (evento: MouseEvent<HTMLDivElement>) => {
    if (arrastou.current) return;
    const lote = loteDoAlvo(evento.target);
    if (lote) alternarSelecao(lote);
  };

  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;
    const lote = loteDoAlvo(evento.target);
    if (!lote) return;
    evento.preventDefault();
    alternarSelecao(lote);
  };

  // Foco dentro de um contêiner com overflow oculto faz o navegador rolar o contêiner; aqui a vista é que se move.
  const aoFocar = (evento: FocusEvent<HTMLDivElement>) => {
    const alvo = (evento.target as Element).closest?.("[data-lote]");
    if (alvo) trazerParaVista(alvo);
  };

  const ampliado = vista.k > 1;

  return (
    <div className="min-w-0">
      <div className="relative">
        <div
          ref={moldura}
          role="group"
          aria-label={`Mapa interativo dos lotes do loteamento ${nomeLoteamento}`}
          onPointerDown={aoApertar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
          onPointerLeave={() => setDica(null)}
          onClick={aoClicar}
          onKeyDown={aoTeclar}
          onFocus={aoFocar}
          style={{ touchAction: ampliado ? "none" : "pan-y" }}
          className="mapa-lotes relative min-h-56 overflow-hidden rounded-[1.5rem] border border-brand-dark/10 bg-white select-none"
        >
          {carga.estado === "pronto" ? (
            <div
              ref={conteudo}
              style={{
                transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})`,
                transformOrigin: "0 0",
                transition: gesto || reduzir ? "none" : "transform 0.4s var(--nova-ease)",
              }}
              dangerouslySetInnerHTML={{ __html: carga.html }}
            />
          ) : (
            <div role="status" className="grid min-h-56 place-items-center p-6 text-center text-sm text-[#526B78]">
              {carga.estado === "carregando" ? (
                <span className="animate-pulse">Carregando o mapa dos lotes…</span>
              ) : (
                "Não foi possível carregar o mapa agora. Consulte a lista de lotes abaixo."
              )}
            </div>
          )}
        </div>

        {carga.estado === "pronto" && (
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <BotaoMapa rotulo="Ampliar o mapa" desligado={vista.k >= ZOOM_MAXIMO} onClick={() => ampliarNoCentro(1.6)}>
              <Plus aria-hidden="true" className="size-4" />
            </BotaoMapa>
            <BotaoMapa rotulo="Reduzir o mapa" desligado={!ampliado} onClick={() => ampliarNoCentro(1 / 1.6)}>
              <Minus aria-hidden="true" className="size-4" />
            </BotaoMapa>
            <BotaoMapa rotulo="Restaurar a visão completa do mapa" desligado={!ampliado} onClick={() => aplicar({ x: 0, y: 0, k: 1 })}>
              <Maximize2 aria-hidden="true" className="size-4" />
            </BotaoMapa>
          </div>
        )}

        {dica && !selecionado && (
          <div
            aria-hidden="true"
            style={{ left: dica.x, top: dica.y }}
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] rounded-xl bg-brand-dark px-3 py-2 text-xs font-medium whitespace-nowrap text-white shadow-lg"
          >
            Quadra {dica.lote.quadra} · Lote {dica.lote.numero} · {ROTULO_STATUS[dica.lote.status]}
          </div>
        )}

        {selecionado && (
          <div
            key={selecionado.id}
            role="status"
            className="mapa-cartao absolute right-3 bottom-3 left-3 z-10 rounded-2xl border border-brand-dark/10 bg-white p-4 shadow-[0_24px_50px_-24px_rgba(28,40,50,0.6)] sm:right-auto sm:w-72"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark">{identificarLote(selecionado)}</p>
                <p className="mt-0.5 text-xs text-[#526B78]">{formatarArea(selecionado.areaM2)}</p>
              </div>
              <button
                type="button"
                onClick={() => onSelecionar(null)}
                aria-label="Fechar detalhes do lote"
                className="-m-2 grid size-11 shrink-0 place-items-center rounded-full text-brand-dark/70 transition-colors duration-300 hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-(--nova-acento)"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <BadgeStatus status={selecionado.status} />
              {selecionado.status === "disponivel" && (
                <Link
                  href={hrefInteresse(slug, selecionado)}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-(--nova-acento)"
                >
                  Tenho interesse
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-[#526B78]">
        <ul aria-label="Legenda do mapa" className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGENDA.map(({ status, cor }) => (
            <li key={status} className="inline-flex items-center gap-2">
              <span aria-hidden="true" className={`size-3 rounded-sm ${cor}`} />
              {ROTULO_STATUS[status]}
            </li>
          ))}
        </ul>
        <p>Toque ou clique num lote para ver os detalhes. Ctrl + rolagem ou pinça para ampliar.</p>
      </div>
    </div>
  );
}
