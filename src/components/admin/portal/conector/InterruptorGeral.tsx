"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";

type Props = { adminPath: string; ligado: boolean; ehAdmin: boolean };

export function InterruptorGeral({ adminPath, ligado: inicial, ehAdmin }: Props) {
  const router = useRouter();
  const [ligado, setLigado] = useState(inicial);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    setTrabalhando(true);
    setErro(null);
    const resposta = await chamarPortal<{ liberacaoAutomaticaGeral: boolean }>(
      adminPath, "conector/configuracao", "PATCH", { liberacaoAutomaticaGeral: !ligado },
    );
    setTrabalhando(false);
    if (!resposta.ok || !resposta.details) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return;
    }
    setLigado(resposta.details.liberacaoAutomaticaGeral);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {ehAdmin && (
          <button type="button" role="switch" aria-checked={ligado} aria-label="Liberação automática" disabled={trabalhando} onClick={alternar}
            className="relative h-7 w-12 shrink-0 rounded-full border bg-muted outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-checked:bg-primary">
            <span aria-hidden="true" className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform ${ligado ? "translate-x-5" : ""}`} />
          </button>
        )}
        <span className="text-sm font-medium">{ligado ? "Ligada" : "Desligada"}</span>
      </div>
      {!ehAdmin && <p className="text-sm text-muted-foreground">Só o administrador liga ou desliga a liberação automática.</p>}
      <p className="max-w-prose text-sm text-muted-foreground">
        {ligado
          ? "Os documentos só são liberados sozinhos nos empreendimentos e pastas em que a liberação automática também estiver ligada."
          : "Nenhum documento é liberado sozinho: tudo o que chega do servidor espera a sua liberação em “Chegaram do servidor”."}
      </p>
      <div aria-live="polite"><MensagemDeErro>{erro}</MensagemDeErro></div>
    </div>
  );
}
