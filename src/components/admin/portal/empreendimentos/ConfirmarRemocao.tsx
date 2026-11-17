"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";

export function ConfirmarRemocao({ adminPath, recurso, id, aviso, rotulo = "Confirmar remoção", aoConcluir, aoCancelar }: {
  adminPath: string; recurso: "empreendimentos" | "projetos" | "empreendimento-clientes" | "modelos"; id: string; aviso: string; rotulo?: string; aoConcluir: () => void; aoCancelar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function remover() {
    setOcupado(true);
    setErro("");
    const resposta = await chamarPortal(adminPath, recurso, "DELETE", { id });
    setOcupado(false);
    if (!resposta.ok) {
      setErro(resposta.erro ?? "Não foi possível excluir.");
      return;
    }
    aoConcluir();
  }

  return (
    <div className="space-y-3 rounded-xl border border-destructive/40 p-4" role="group" aria-label="Confirmar remoção">
      <p className="text-sm">{aviso}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" className="portal-botao" disabled={ocupado} onClick={remover}><Check aria-hidden="true" />{ocupado ? "Removendo…" : rotulo}</Button>
        <Button type="button" variant="outline" className="portal-botao" disabled={ocupado} onClick={aoCancelar}><X aria-hidden="true" />Cancelar</Button>
      </div>
      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}
