"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { dataSaoPaulo } from "@/lib/portal/conector/formato";
import { ROTULO_DO_MODO, type SugestaoDoRecalculo } from "@/lib/portal/etapas/tipos";
import { MODOS_DE_ETAPAS, type ModoDeEtapas } from "@/lib/portal/pasta/tipos";
import { Caixa } from "./campos";

type Props = {
  adminPath: string;
  empreendimentoId: string;
  modo: ModoDeEtapas;
  // Mudar o modo pede empreendimentos.editar; o Automático, só o admin (o banco também barra).
  podeEditar: boolean;
  ehAdmin: boolean;
  aoAvisar: (mensagem: string) => void;
};

const AJUDA_DO_MODO: Record<ModoDeEtapas, string> = {
  desligado: "As etapas dos projetos só mudam à mão, como sempre.",
  sugerir: "Quando chega um PDF de protocolo, de devolutiva ou de aprovado, o projeto mostra uma sugestão de etapa com Confirmar e Ignorar. O cliente só vê a etapa nova depois de confirmada.",
  automatico: "A etapa do projeto muda sozinha quando o PDF chega. Cada mudança entra no histórico do projeto e pode ser desfeita.",
};

export function EtapasPelasPastas({ adminPath, empreendimentoId, modo, podeEditar, ehAdmin, aoAvisar }: Props) {
  const router = useRouter();
  const [escolhido, setEscolhido] = useState<ModoDeEtapas>(modo);
  const [ocupado, setOcupado] = useState<"modo" | "lista" | "aplicar" | null>(null);
  const [erro, setErro] = useState("");
  const [sugestoes, setSugestoes] = useState<SugestaoDoRecalculo[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erroDaLista, setErroDaLista] = useState("");
  // Quem não é admin não liga o Automático nem tira um empreendimento dele (o gatilho do banco recusa as duas coisas).
  const travado = !podeEditar || (modo === "automatico" && !ehAdmin);

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setOcupado("modo");
    setErro("");
    const resposta = await chamarPortal(adminPath, "etapas-automaticas/modo", "PATCH", { empreendimentoId, modo: escolhido });
    setOcupado(null);
    if (!resposta.ok) {
      setErro(resposta.erro ?? "Não foi possível salvar.");
      return;
    }
    setSugestoes(null);
    aoAvisar(`Etapas pelas pastas: ${ROTULO_DO_MODO[escolhido].toLowerCase()}.`);
    router.refresh();
  }

  async function recalcular() {
    setOcupado("lista");
    setErroDaLista("");
    const resposta = await chamarPortal<SugestaoDoRecalculo[]>(adminPath, `etapas-automaticas/recalculo?empreendimentoId=${empreendimentoId}`, "GET");
    setOcupado(null);
    if (!resposta.ok || !resposta.details) {
      setErroDaLista(resposta.erro ?? "Não foi possível ler as sugestões.");
      return;
    }
    setSugestoes(resposta.details);
    setMarcados(new Set(resposta.details.map((sugestao) => sugestao.projetoId)));
  }

  async function aplicar() {
    const itens = (sugestoes ?? []).filter((sugestao) => marcados.has(sugestao.projetoId))
      .map((sugestao) => ({ projetoId: sugestao.projetoId, sinalId: sugestao.sinalId }));
    if (itens.length === 0) return;
    setOcupado("aplicar");
    setErroDaLista("");
    const resposta = await chamarPortal<{ aplicadas: number }>(adminPath, "etapas-automaticas/recalculo", "POST", { empreendimentoId, itens });
    setOcupado(null);
    if (!resposta.ok) {
      setErroDaLista(resposta.erro ?? "Não foi possível atualizar as etapas. Nada foi alterado.");
      return;
    }
    const aplicadas = resposta.details?.aplicadas ?? 0;
    const mudaram = itens.length - aplicadas;
    setSugestoes(null);
    aoAvisar((aplicadas === 1 ? "1 projeto teve a etapa atualizada." : `${aplicadas} projetos tiveram a etapa atualizada.`)
      + (mudaram > 0 ? ` ${mudaram} mudaram enquanto a lista estava aberta; recalcule de novo para conferir.` : ""));
    router.refresh();
  }

  function alternar(projetoId: string, marcado: boolean) {
    setMarcados((atuais) => {
      const proximos = new Set(atuais);
      if (marcado) proximos.add(projetoId);
      else proximos.delete(projetoId);
      return proximos;
    });
  }

  return (
    <div className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <form onSubmit={salvar} noValidate aria-label="Etapas pelas pastas" className="min-w-0 space-y-3">
        <Field className="min-w-0">
          <FieldLabel htmlFor="etapas-modo">Etapas pelas pastas</FieldLabel>
          <Select id="etapas-modo" value={escolhido} disabled={travado || ocupado !== null} aria-describedby="etapas-modo-ajuda" className="max-w-64"
            onChange={(evento) => setEscolhido(MODOS_DE_ETAPAS.find((candidato) => candidato === evento.target.value) ?? "desligado")}>
            {MODOS_DE_ETAPAS.map((candidato) => (
              <option key={candidato} value={candidato} disabled={candidato === "automatico" && !ehAdmin}>
                {ROTULO_DO_MODO[candidato]}{candidato === "automatico" && !ehAdmin ? " (só o administrador)" : ""}
              </option>
            ))}
          </Select>
          <p id="etapas-modo-ajuda" className="text-sm text-muted-foreground">{AJUDA_DO_MODO[escolhido]}</p>
        </Field>
        {escolhido === "automatico" && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="note">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Um PDF salvo na pasta errada muda a etapa do projeto sem conferência. Cada mudança tem “Desfazer” no histórico do projeto.</span>
          </p>
        )}
        {modo === "automatico" && !ehAdmin && <p className="text-sm text-muted-foreground">Este empreendimento está no modo automático: só o administrador muda esta chave.</p>}
        {!podeEditar && <p className="text-sm text-muted-foreground">Você pode ver o modo, mas não mudá-lo.</p>}
        <Button type="submit" className="portal-botao" disabled={travado || ocupado !== null || escolhido === modo}><Save aria-hidden="true" />{ocupado === "modo" ? "Salvando…" : "Salvar"}</Button>
        <MensagemDeErro>{erro}</MensagemDeErro>
      </form>

      {podeEditar && modo !== "desligado" && (
        <div className="min-w-0 space-y-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">Lê os arquivos que já chegaram e mostra a etapa que cada projeto teria hoje. Você escolhe o que aplicar.</p>
          <Button type="button" variant="outline" className="portal-botao" disabled={ocupado !== null} onClick={recalcular}>
            <RefreshCw aria-hidden="true" />{ocupado === "lista" ? "Lendo os arquivos…" : sugestoes ? "Ler de novo" : "Recalcular etapas"}
          </Button>
          <MensagemDeErro>{erroDaLista}</MensagemDeErro>

          {sugestoes && sugestoes.length === 0 && <p className="text-sm text-muted-foreground" role="status">Nenhum projeto precisa mudar de etapa.</p>}
          {sugestoes && sugestoes.length > 0 && (
            <div className="min-w-0 space-y-3">
              <ul className="space-y-2" aria-label="Sugestões de etapa">
                {sugestoes.map((sugestao) => (
                  <li key={sugestao.projetoId} className="min-w-0 rounded-lg border p-3">
                    <Caixa marcada={marcados.has(sugestao.projetoId)} aoMudar={(marcado) => alternar(sugestao.projetoId, marcado)} desabilitada={ocupado !== null}>
                      <span className="font-medium">{sugestao.projetoNome}</span>
                      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
                        {sugestao.deEtapaNome ?? "Sem etapa"}<ArrowRight className="size-3.5 shrink-0" aria-hidden="true" /><span className="text-foreground">{sugestao.paraEtapaNome}</span>
                        <span>({dataSaoPaulo(sugestao.dataArquivo)}{sugestao.arquivo ? `, ${sugestao.arquivo}` : ""})</span>
                      </span>
                    </Caixa>
                  </li>
                ))}
              </ul>
              <Button type="button" className="portal-botao" disabled={ocupado !== null || marcados.size === 0} onClick={aplicar}>
                {ocupado === "aplicar" ? "Atualizando…" : `Confirmar ${marcados.size} ${marcados.size === 1 ? "projeto" : "projetos"}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
