"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { Caixa } from "./campos";

type Props = {
  adminPath: string;
  empreendimentoId: string;
  codigoPasta: string | null;
  liberacaoAutomatica: boolean;
  liberacaoGeral: boolean | null;
  ehAdmin: boolean;
  aoAvisar: (mensagem: string) => void;
};

const SEIS_DIGITOS = /^[0-9]{6}$/;

const ESTADO_DO_GERAL: Record<"ligado" | "desligado" | "desconhecido", string> = {
  ligado: "Hoje o interruptor geral está ligado.",
  desligado: "Hoje o interruptor geral está desligado: nada é liberado sozinho, mesmo com este ligado.",
  desconhecido: "Não foi possível consultar o interruptor geral agora.",
};

export function ConfiguracaoDaPasta({ adminPath, empreendimentoId, codigoPasta, liberacaoAutomatica, liberacaoGeral, ehAdmin, aoAvisar }: Props) {
  const router = useRouter();
  const [codigo, setCodigo] = useState(codigoPasta ?? "");
  const [liberacao, setLiberacao] = useState(liberacaoAutomatica);
  const [ocupado, setOcupado] = useState<"codigo" | "liberacao" | null>(null);
  const [erroCodigo, setErroCodigo] = useState("");
  const [erroLiberacao, setErroLiberacao] = useState("");
  const estadoDoGeral = liberacaoGeral === null ? "desconhecido" : liberacaoGeral ? "ligado" : "desligado";
  // Trocar o código de um empreendimento com liberação automática ligada publicaria arquivos de outra pasta para o cliente.
  const codigoTravado = !ehAdmin && liberacaoAutomatica;

  async function salvarCodigo(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpo = codigo.trim();
    if (limpo !== "" && !SEIS_DIGITOS.test(limpo)) {
      setErroCodigo("O código da pasta tem 6 dígitos (ou deixe vazio para desligar o envio pelo servidor).");
      return;
    }
    setOcupado("codigo");
    setErroCodigo("");
    const resposta = await chamarPortal(adminPath, "empreendimentos", "PATCH", { id: empreendimentoId, codigoPasta: limpo === "" ? null : limpo });
    setOcupado(null);
    if (!resposta.ok) {
      setErroCodigo(resposta.erro ?? "Não foi possível salvar o código.");
      return;
    }
    setCodigo(limpo);
    aoAvisar(limpo === "" ? "Código removido: o servidor não envia mais documentos deste empreendimento." : "Código da pasta salvo.");
    router.refresh();
  }

  async function salvarLiberacao(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setOcupado("liberacao");
    setErroLiberacao("");
    const resposta = await chamarPortal(adminPath, "empreendimentos", "PATCH", { id: empreendimentoId, liberacaoAutomatica: liberacao });
    setOcupado(null);
    if (!resposta.ok) {
      setErroLiberacao(resposta.erro ?? "Não foi possível salvar.");
      return;
    }
    aoAvisar(liberacao ? "Liberação automática ligada para este empreendimento." : "Liberação automática desligada para este empreendimento.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={salvarCodigo} noValidate aria-label="Código da pasta" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
        <Field>
          <FieldLabel htmlFor="pasta-codigo">Código da pasta (6 dígitos)</FieldLabel>
          <Input id="pasta-codigo" value={codigo} inputMode="numeric" maxLength={6} autoComplete="off" disabled={ocupado !== null || codigoTravado} aria-describedby="pasta-codigo-ajuda" aria-invalid={erroCodigo !== ""}
            onChange={(evento) => setCodigo(evento.target.value)} className="max-w-48" />
          <p id="pasta-codigo-ajuda" className="text-sm text-muted-foreground">É o número que abre o nome da pasta do empreendimento no servidor (“123456 - Nome”). Cada código só pode ser de um empreendimento.</p>
        </Field>
        {codigoTravado && <p className="text-sm text-muted-foreground">Este empreendimento está com a liberação automática ligada: só o administrador troca o código da pasta.</p>}
        <Button type="submit" className="portal-botao" disabled={ocupado !== null || codigoTravado}><Save aria-hidden="true" />{ocupado === "codigo" ? "Salvando…" : "Salvar código"}</Button>
        <MensagemDeErro>{erroCodigo}</MensagemDeErro>
      </form>

      {!ehAdmin ? (
        <div className="min-w-0 space-y-2 rounded-xl border bg-card p-5">
          <p className="font-medium">Liberação automática: {liberacaoAutomatica ? "ligada" : "desligada"}</p>
          <p className="text-sm text-muted-foreground">Só o administrador liga ou desliga a liberação automática. {ESTADO_DO_GERAL[estadoDoGeral]}</p>
        </div>
      ) : (
      <form onSubmit={salvarLiberacao} aria-label="Liberação automática" className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
        <Caixa marcada={liberacao} aoMudar={setLiberacao} desabilitada={ocupado !== null}><span className="font-medium">Liberação automática</span></Caixa>
        <p className="text-sm text-muted-foreground">
          Vale só para as regras marcadas com “liberar automático” e só enquanto o interruptor geral do conector estiver ligado. {ESTADO_DO_GERAL[estadoDoGeral]} Regras sem a marca, e todo o resto, chegam ocultas e a equipe libera.
        </p>
        {liberacao && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="note">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Com a liberação automática ligada, um PDF enviado pelo servidor aparece para o cliente sem conferência. Quem salvar um arquivo numa pasta com regra “liberar automático” (ou usar a chave do conector) publica o documento para este cliente. Ligue só depois de conferir as regras.</span>
          </p>
        )}
        <Button type="submit" className="portal-botao" disabled={ocupado !== null || liberacao === liberacaoAutomatica}><Save aria-hidden="true" />{ocupado === "liberacao" ? "Salvando…" : "Salvar liberação"}</Button>
        <MensagemDeErro>{erroLiberacao}</MensagemDeErro>
      </form>
      )}
    </div>
  );
}
