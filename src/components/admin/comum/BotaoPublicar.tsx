"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { chamarApi } from "./cliente-api";

type Props = {
  adminPath: string;
  // Rota do registro, relativa a /api/conteudo/, ex.: "loteamentos/<id>". Recebe PATCH { publicado }.
  caminho: string;
  publicado: boolean;
  rotulo: string;
};

// Interruptor com troca imediata na tela e volta atrás se o servidor recusar.
export function BotaoPublicar({ adminPath, caminho, publicado, rotulo }: Props) {
  const router = useRouter();
  const [ligado, setLigado] = useState(publicado);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    const novo = !ligado;
    setLigado(novo);
    setSalvando(true);
    setErro(null);

    const resposta = await chamarApi(adminPath, caminho, "PATCH", { publicado: novo });
    setSalvando(false);

    if (!resposta.ok) {
      setLigado(!novo);
      setErro(resposta.erro);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={`${rotulo}: ${ligado ? "publicado" : "rascunho"}`}
        disabled={salvando}
        onClick={alternar}
        className="group inline-flex items-center gap-2 rounded-full text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input transition-colors group-aria-checked:bg-brand"
        >
          <span className="absolute left-0.5 size-4 rounded-full bg-white shadow transition-transform group-aria-checked:translate-x-4 motion-reduce:transition-none" />
        </span>
        <span className={ligado ? "font-medium" : "text-muted-foreground"}>{ligado ? "Publicado" : "Rascunho"}</span>
      </button>
      {erro && (
        <span role="alert" className="text-xs text-destructive">
          {erro}
        </span>
      )}
    </div>
  );
}
