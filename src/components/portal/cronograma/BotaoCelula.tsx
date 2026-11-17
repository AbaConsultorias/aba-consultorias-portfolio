"use client";

import { useEffect, useRef, type ReactNode } from "react";

const ESPERA_HOVER_MS = 1500;
const ESPERA_FECHAR_MS = 200;
const DISTANCIA = 8;
const MARGEM_TELA = 12;

// Célula do cronograma. Toque ou clique abre o detalhe no centro da tela (popover
// nativo). Com mouse, parar 1,5 s em cima abre o mesmo cartão flutuando ao lado da
// célula, como uma dica, e ele some quando o mouse sai da célula e do cartão.
export function BotaoCelula({ alvo, rotulo, children }: { alvo: string; rotulo: string; children: ReactNode }) {
  const botao = useRef<HTMLButtonElement>(null);
  const abrir = useRef<number | null>(null);
  const fechar = useRef<number | null>(null);

  const limpar = (timer: { current: number | null }) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    const detalhe = document.getElementById(alvo);
    if (!detalhe) return;
    const manter = () => limpar(fechar);
    const sair = () => agendarFechamento();
    const aoAlternar = (evento: Event) => {
      if ((evento as ToggleEvent).newState === "closed") {
        delete detalhe.dataset.modo;
        detalhe.style.removeProperty("top");
        detalhe.style.removeProperty("left");
      }
    };
    detalhe.addEventListener("pointerenter", manter);
    detalhe.addEventListener("pointerleave", sair);
    detalhe.addEventListener("toggle", aoAlternar);
    return () => {
      limpar(abrir);
      limpar(fechar);
      detalhe.removeEventListener("pointerenter", manter);
      detalhe.removeEventListener("pointerleave", sair);
      detalhe.removeEventListener("toggle", aoAlternar);
    };
    // agendarFechamento só lê refs e o id; não muda entre renderizações.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  function agendarFechamento() {
    limpar(fechar);
    fechar.current = window.setTimeout(() => {
      fechar.current = null;
      const detalhe = document.getElementById(alvo);
      if (detalhe?.dataset.modo === "flutuante" && detalhe.matches(":popover-open")) detalhe.hidePopover();
    }, ESPERA_FECHAR_MS);
  }

  function abrirAoLado() {
    const detalhe = document.getElementById(alvo);
    const celula = botao.current;
    if (!detalhe || !celula || detalhe.matches(":popover-open")) return;
    detalhe.dataset.modo = "flutuante";
    detalhe.showPopover();
    const caixa = (celula.closest("td") ?? celula).getBoundingClientRect();
    const cartao = detalhe.getBoundingClientRect();
    const largura = window.innerWidth;
    const altura = window.innerHeight;
    // Abaixo da célula; sem espaço, acima; alinhado à esquerda da célula, sem sair da tela.
    let topo = caixa.bottom + DISTANCIA;
    if (topo + cartao.height > altura - MARGEM_TELA) topo = Math.max(MARGEM_TELA, caixa.top - DISTANCIA - cartao.height);
    const esquerda = Math.min(Math.max(MARGEM_TELA, caixa.left), largura - cartao.width - MARGEM_TELA);
    detalhe.style.top = `${topo}px`;
    detalhe.style.left = `${Math.max(MARGEM_TELA, esquerda)}px`;
  }

  return (
    <button
      ref={botao}
      type="button"
      popoverTarget={alvo}
      className="cron-celula-botao"
      aria-label={rotulo}
      onPointerEnter={(evento) => {
        if (evento.pointerType !== "mouse") return;
        limpar(fechar);
        limpar(abrir);
        abrir.current = window.setTimeout(() => {
          abrir.current = null;
          abrirAoLado();
        }, ESPERA_HOVER_MS);
      }}
      onPointerLeave={(evento) => {
        if (evento.pointerType !== "mouse") return;
        limpar(abrir);
        agendarFechamento();
      }}
      onPointerDown={() => limpar(abrir)}
    >
      {children}
    </button>
  );
}
