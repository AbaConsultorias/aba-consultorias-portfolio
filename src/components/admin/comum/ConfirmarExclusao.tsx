"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "./campos";

type Props = {
  rotulo?: string;
  aviso: string;
  // Devolve a mensagem de erro, ou null quando deu certo.
  aoConfirmar: () => Promise<string | null>;
  tamanho?: "default" | "sm" | "xs";
};

export function ConfirmarExclusao({ rotulo = "Excluir", aviso, aoConfirmar, tamanho = "sm" }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setExcluindo(true);
    setErro(null);
    const falha = await aoConfirmar();
    setExcluindo(false);
    if (falha) setErro(falha);
  }

  if (!confirmando) {
    return (
      <Button type="button" variant="destructive" size={tamanho} onClick={() => setConfirmando(true)}>
        <Trash2 aria-hidden="true" />
        {rotulo}
      </Button>
    );
  }

  return (
    <div role="alertdialog" aria-label="Confirmar exclusão" className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
      <p className="text-sm">{aviso}</p>
      <MensagemDeErro>{erro}</MensagemDeErro>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" size={tamanho} disabled={excluindo} onClick={confirmar}>
          {excluindo ? "Excluindo..." : "Sim, excluir"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size={tamanho}
          disabled={excluindo}
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
