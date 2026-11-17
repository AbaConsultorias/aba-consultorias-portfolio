"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { dataSaoPaulo } from "@/lib/portal/conector/formato";
import type { SugestaoDeEtapa } from "@/lib/portal/etapas/tipos";

type Props = { adminPath: string; projetoId: string; sugestao: SugestaoDeEtapa; podeEditar: boolean; compacto?: boolean };

// "Sugestão: Em análise da Copasa (por x.pdf, 12/11/2026)". Nome de arquivo sempre como texto, nunca HTML.
export function CartaoDeSugestao({ adminPath, projetoId, sugestao, podeEditar, compacto = false }: Props) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<"confirmar" | "ignorar" | null>(null);
  const [erro, setErro] = useState("");
  const origem = sugestao.arquivo ? `por ${sugestao.arquivo}, ${dataSaoPaulo(sugestao.dataArquivo)}` : `por um arquivo de ${dataSaoPaulo(sugestao.dataArquivo)}`;

  async function enviar(acao: "confirmar" | "ignorar") {
    setOcupado(acao);
    setErro("");
    const corpo = acao === "confirmar" ? { projetoId, sinalId: sugestao.sinalId } : { sinalId: sugestao.sinalId };
    const resposta = await chamarPortal(adminPath, `etapas-automaticas/${acao}`, "POST", corpo);
    setOcupado(null);
    if (!resposta.ok) {
      setErro(resposta.erro ?? "Não foi possível concluir. Atualize a tela e tente de novo.");
      // A sugestão pode ter deixado de valer; recarregar mostra a de agora.
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <div className={`min-w-0 space-y-2 rounded-lg border border-primary/40 bg-primary/5 ${compacto ? "p-3" : "p-4"}`} role="group" aria-label="Sugestão de etapa">
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">Sugestão: {sugestao.etapaNome}</span> ({origem})</span>
      </p>
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="portal-botao" disabled={ocupado !== null} onClick={() => enviar("confirmar")}>
            <Check aria-hidden="true" />{ocupado === "confirmar" ? "Confirmando…" : "Confirmar"}
          </Button>
          <Button type="button" variant="outline" className="portal-botao" disabled={ocupado !== null} onClick={() => enviar("ignorar")}>
            <X aria-hidden="true" />{ocupado === "ignorar" ? "Ignorando…" : "Ignorar"}
          </Button>
        </div>
      )}
      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}
