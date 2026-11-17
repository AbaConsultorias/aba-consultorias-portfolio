"use client";

import { useSyncExternalStore } from "react";

// O useReducedMotion do motion lê a mídia já no primeiro render do cliente e diverge do HTML do
// servidor; aqui o servidor e a hidratação concordam (false) e o valor real chega logo depois.
function useConsultaDeMidia(consulta: string) {
  return useSyncExternalStore(
    (avisar) => {
      const midia = window.matchMedia(consulta);
      midia.addEventListener("change", avisar);
      return () => midia.removeEventListener("change", avisar);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}

export function useMovimentoReduzido() {
  return useConsultaDeMidia("(prefers-reduced-motion: reduce)");
}

export function usePonteiroFino() {
  return useConsultaDeMidia("(hover: hover) and (pointer: fine)");
}
