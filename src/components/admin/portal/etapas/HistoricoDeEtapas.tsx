"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { Selo } from "@/components/admin/portal/empreendimentos/Selos";
import { dataHoraSaoPaulo } from "@/lib/portal/conector/formato";
import { ROTULO_DA_ORIGEM, type MudancaDeEtapa } from "@/lib/portal/etapas/tipos";

type Props = { adminPath: string; historico: MudancaDeEtapa[] };

export function HistoricoDeEtapas({ adminPath, historico }: Props) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function desfazer(historicoId: string) {
    setOcupado(true);
    setErro("");
    const resposta = await chamarPortal(adminPath, "etapas-automaticas/desfazer", "POST", { historicoId });
    setOcupado(false);
    setConfirmando(null);
    if (!resposta.ok) setErro(resposta.erro ?? "Não foi possível desfazer. Atualize a tela e tente de novo.");
    router.refresh();
  }

  if (historico.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma mudança de etapa registrada ainda.</p>;
  return (
    <div className="min-w-0 space-y-3">
      <ol className="space-y-2" aria-label="Histórico das mudanças de etapa">
        {historico.map((mudanca) => (
          <li key={mudanca.id} className="min-w-0 space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Selo tom={mudanca.origem === "manual" ? "neutro" : "info"}>{ROTULO_DA_ORIGEM[mudanca.origem]}</Selo>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium [overflow-wrap:anywhere]">
                {mudanca.deEtapaNome ?? "—"}<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{mudanca.paraEtapaNome ?? "—"}
              </span>
              {mudanca.desfeita && <Selo tom="aviso">Desfeita</Selo>}
            </div>
            <p className="text-muted-foreground [overflow-wrap:anywhere]">
              {dataHoraSaoPaulo(mudanca.em)}
              {mudanca.porNome ? ` · ${mudanca.porNome}` : mudanca.origem === "automatico" ? " · automática" : ""}
              {mudanca.arquivo ? ` · arquivo: ${mudanca.arquivo}` : ""}
            </p>
            {mudanca.podeDesfazer && confirmando !== mudanca.id && (
              <Button type="button" variant="outline" className="portal-botao" disabled={ocupado} onClick={() => { setErro(""); setConfirmando(mudanca.id); }}>
                <Undo2 aria-hidden="true" />Desfazer<span className="sr-only"> a mudança para {mudanca.paraEtapaNome ?? "esta etapa"}</span>
              </Button>
            )}
            {confirmando === mudanca.id && (
              <div role="alertdialog" aria-label="Confirmar desfazer" className="min-w-0 space-y-2 rounded-lg border p-3">
                <p>Voltar o projeto para “{mudanca.deEtapaNome ?? "a etapa anterior"}”? As datas de conclusão que esta mudança preencheu voltam como estavam.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="portal-botao" disabled={ocupado} onClick={() => desfazer(mudanca.id)}>{ocupado ? "Desfazendo…" : "Confirmar e desfazer"}</Button>
                  <Button type="button" variant="outline" className="portal-botao" disabled={ocupado} onClick={() => setConfirmando(null)}>Cancelar</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}
