"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { TAMANHO_MAXIMO_PREFIXO, validarPrefixoDeRegra } from "@/lib/conector/sugestoes";
import type { ProjetoDaPasta, TipoDeRegraDePasta } from "@/lib/portal/pasta/tipos";
import { Caixa, EditorDeDestino, MarcaAprovado, SeletorDeTipo } from "./campos";
import { caminhoSugereAprovado, comCategoriaSugerida, destinoCompletoDoTipo, ehTipoDeEtapa, SEM_DESTINO, type Destino } from "./destino";

type Props = { adminPath: string; empreendimentoId: string; projetos: ProjetoDaPasta[]; ehAdmin: boolean; aoAvisar: (mensagem: string) => void };

export function NovaRegra({ adminPath, empreendimentoId, projetos, ehAdmin, aoAvisar }: Props) {
  const router = useRouter();
  const [caminho, setCaminho] = useState("");
  const [tipo, setTipo] = useState<TipoDeRegraDePasta>("comum");
  const [destino, setDestino] = useState<Destino>(SEM_DESTINO);
  const [liberar, setLiberar] = useState(false);
  // null = a pessoa ainda não mexeu: a caixa segue o caminho (pasta com APROVAD já vem marcada, como no banco).
  const [marcaEscolhida, setMarcaEscolhida] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const mostraMarca = tipo === "comum" && destino.projetoId !== null;
  const marca = marcaEscolhida ?? caminhoSugereAprovado(caminho);
  // Os PDFs de "Outros projetos" ficam ocultos até a equipe liberar: sem liberação automática.
  const aceitaLiberacaoAutomatica = !ehTipoDeEtapa(tipo) && destino.grupo !== "arquivo";

  async function adicionar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const prefixo = validarPrefixoDeRegra(caminho);
    if (!prefixo.valido) {
      setErro(prefixo.motivo);
      return;
    }
    if (destino.grupo === "arquivo" && (destino.rotulo ?? "").trim() === "") {
      setErro("Informe o rótulo do cartão.");
      return;
    }
    if (!destinoCompletoDoTipo(destino, tipo)) {
      setErro("Escolha o destino.");
      return;
    }
    setOcupado(true);
    setErro("");
    const resposta = await chamarPortal(adminPath, "pasta-regras", "POST", {
      empreendimentoId, caminhoPrefixo: prefixo.caminho, tipo, ...destino, ...(mostraMarca ? { marcaAprovado: marca } : {}),
      liberarAutomatico: ehAdmin && liberar && aceitaLiberacaoAutomatica, ativa: true,
    });
    setOcupado(false);
    if (!resposta.ok) {
      setErro(resposta.erro ?? "Não foi possível salvar.");
      return;
    }
    setCaminho("");
    setTipo("comum");
    setDestino(SEM_DESTINO);
    setLiberar(false);
    setMarcaEscolhida(null);
    aoAvisar("Regra adicionada.");
    router.refresh();
  }

  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer font-medium">Adicionar regra manualmente</summary>
      <form onSubmit={adicionar} noValidate aria-label="Adicionar regra de pasta" className="mt-5 space-y-4">
        <Field>
          <FieldLabel htmlFor="nova-regra-caminho">Pasta (relativa à pasta do empreendimento)</FieldLabel>
          <Input id="nova-regra-caminho" value={caminho} maxLength={TAMANHO_MAXIMO_PREFIXO} autoComplete="off" placeholder="03 - PRODUTOS/SAA/APROVADO" disabled={ocupado} onChange={(evento) => setCaminho(evento.target.value)} />
          <p className="text-sm text-muted-foreground">Nomes separados por “/”, sem “\”, “:” nem “..”. Vale para tudo que estiver dentro da pasta.</p>
        </Field>
        <SeletorDeTipo id="nova-regra" valor={tipo} aoMudar={(novo) => { setTipo(novo); setDestino(SEM_DESTINO); setMarcaEscolhida(null); }} desabilitado={ocupado} />
        <EditorDeDestino id="nova-regra" valor={destino} aoMudar={(novo) => setDestino(comCategoriaSugerida(novo, tipo, projetos))} projetos={projetos} desabilitado={ocupado} somenteProjeto={tipo === "equipamentos"} semGrupos={ehTipoDeEtapa(tipo)} />
        {mostraMarca && <MarcaAprovado marcada={marca} aoMudar={setMarcaEscolhida} desabilitada={ocupado} />}
        {ehAdmin && aceitaLiberacaoAutomatica && <Caixa marcada={liberar} aoMudar={setLiberar} desabilitada={ocupado}>Liberar automático</Caixa>}
        <Button type="submit" className="portal-botao" disabled={ocupado}><Plus aria-hidden="true" />{ocupado ? "Salvando…" : "Adicionar regra"}</Button>
        <MensagemDeErro>{erro}</MensagemDeErro>
      </form>
    </details>
  );
}
