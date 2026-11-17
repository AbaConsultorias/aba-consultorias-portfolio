"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  rotulo: string;
  icone: ReactNode;
  aviso: string;
  rotuloConfirmar: string;
  perigosa?: boolean;
  // Devolve a mensagem de erro, ou null quando deu certo.
  aoConfirmar: () => Promise<string | null>;
};

export function ConfirmarAcao({ rotulo, icone, aviso, rotuloConfirmar, perigosa = false, aoConfirmar }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const variante = perigosa ? "destructive" : "outline";

  async function confirmar() {
    setExecutando(true);
    setErro(null);
    const falha = await aoConfirmar();
    setExecutando(false);
    if (falha) setErro(falha);
    else setConfirmando(false);
  }

  if (!confirmando) {
    return (
      <Button type="button" variant={variante} className="min-h-11" onClick={() => setConfirmando(true)}>
        {icone}
        {rotulo}
      </Button>
    );
  }

  return (
    <div role="alertdialog" aria-label={rotulo} className="flex w-full flex-col gap-3 rounded-lg border border-destructive/40 p-3">
      <p className="text-sm">{aviso}</p>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={variante} className="min-h-11" disabled={executando} onClick={confirmar}>
          {executando ? "Aguarde…" : rotuloConfirmar}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={executando}
          onClick={() => {
            setConfirmando(false);
            setErro(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
