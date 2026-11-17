"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  titulo: string;
  senha: string;
  aoFechar: () => void;
};

export function SenhaTemporaria({ titulo, senha, aoFechar }: Props) {
  const [copiada, setCopiada] = useState(false);
  const [falhaAoCopiar, setFalhaAoCopiar] = useState(false);
  const bloco = useRef<HTMLDivElement>(null);

  // A senha pode aparecer longe de quem clicou (a lista é longa): traz o bloco para a vista.
  useEffect(() => {
    bloco.current?.scrollIntoView({ block: "center" });
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiada(true);
      setFalhaAoCopiar(false);
    } catch {
      setFalhaAoCopiar(true);
    }
  }

  return (
    <div ref={bloco} role="alert" className="space-y-3 rounded-xl border border-primary/40 bg-card p-5">
      <h3 className="font-semibold">{titulo}</h3>
      <p className="text-sm leading-relaxed">
        Anote ou copie a senha agora: <strong>ela não será mostrada de novo</strong>. Entregue por um canal seguro.
        No primeiro acesso a pessoa será obrigada a trocá-la.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="min-h-11 select-all break-all rounded-lg border bg-muted px-3 py-2.5 font-mono text-base">{senha}</code>
        <Button type="button" variant="outline" className="min-h-11" onClick={copiar}>
          {copiada ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copiada ? "Copiada" : "Copiar senha"}
        </Button>
      </div>
      {falhaAoCopiar && <p className="text-sm text-destructive">Não foi possível copiar. Selecione a senha e copie manualmente.</p>}
      <Button type="button" className="min-h-11" onClick={aoFechar}>
        <X aria-hidden="true" />
        Já anotei, fechar
      </Button>
    </div>
  );
}
