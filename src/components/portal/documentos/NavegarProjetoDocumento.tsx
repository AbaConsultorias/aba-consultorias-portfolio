"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { projetoDoHash } from "@/lib/portal/documentos/regras";

export function NavegarProjetoDocumento() {
  const router = useRouter();

  useEffect(() => {
    function localizarProjeto() {
      const projetoId = projetoDoHash(window.location.hash);
      if (!projetoId || document.getElementById(`projeto-${projetoId}`)) return;
      const parametros = new URLSearchParams(window.location.search);
      if (parametros.get("projeto") === projetoId) return;
      parametros.set("projeto", projetoId);
      parametros.delete("pagina");
      router.replace(`${window.location.pathname}?${parametros}#projeto-${projetoId}`, { scroll: false });
    }
    localizarProjeto();
    window.addEventListener("hashchange", localizarProjeto);
    return () => window.removeEventListener("hashchange", localizarProjeto);
  }, [router]);

  return null;
}
