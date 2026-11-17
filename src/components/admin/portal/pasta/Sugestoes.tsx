"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { sugerirRegras, type SugestaoDeRegra } from "@/lib/conector/sugestoes";
import type { ArvoreDaPasta, ProjetoDaPasta, RegraDePasta } from "@/lib/portal/pasta/tipos";
import { Caixa, EditorDeDestino } from "./campos";
import { destinoCompleto, type Destino } from "./destino";

type Item = { sugestao: SugestaoDeRegra; marcada: boolean; destino: Destino; liberar: boolean; erro: string };
type Props = {
  adminPath: string;
  empreendimentoId: string;
  arvore: ArvoreDaPasta;
  projetos: ProjetoDaPasta[];
  regras: RegraDePasta[];
  ehAdmin: boolean;
  aoAvisar: (mensagem: string) => void;
};

const SEM_ARVORE: Record<"sem-codigo" | "sem-arvore", string> = {
  "sem-codigo": "Informe e salve o código da pasta acima para o programa do servidor poder listar as pastas deste empreendimento.",
  "sem-arvore": "O programa do servidor ainda não informou as pastas deste código. Ele envia a lista ao fim de cada ciclo (a cada 10 minutos): confira se está rodando no servidor e se existe uma pasta que começa com este código.",
};

export function Sugestoes({ adminPath, empreendimentoId, arvore, projetos, regras, ehAdmin, aoAvisar }: Props) {
  const router = useRouter();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  function gerar() {
    if (arvore.situacao !== "ok") return;
    setErro("");
    const sugestoes = sugerirRegras({
      pastas: arvore.pastas,
      projetos: projetos.map(({ id, nome, modeloNome }) => ({ id, nome, modeloNome })),
      regrasExistentes: regras.map((regra) => regra.caminhoPrefixo),
    });
    setItens(sugestoes.map((sugestao) => {
      const destino: Destino = { projetoId: sugestao.projetoId, categoriaId: null, grupo: sugestao.grupo, rotulo: null };
      return { sugestao, marcada: destinoCompleto(destino), destino, liberar: false, erro: "" };
    }));
  }

  function mudar(indice: number, mudanca: Partial<Item>) {
    setItens((atuais) => atuais && atuais.map((item, i) => (i === indice ? { ...item, ...mudanca, erro: "" } : item)));
  }

  async function salvarMarcadas() {
    if (!itens) return;
    if (!itens.some((item) => item.marcada)) {
      setErro("Marque ao menos uma regra para salvar.");
      return;
    }
    setOcupado(true);
    setErro("");
    const restantes: Item[] = [];
    let salvas = 0;
    for (const item of itens) {
      if (!item.marcada) {
        restantes.push(item);
        continue;
      }
      if (!destinoCompleto(item.destino)) {
        restantes.push({ ...item, erro: "Escolha o destino ou desmarque esta regra." });
        continue;
      }
      const resposta = await chamarPortal(adminPath, "pasta-regras", "POST", {
        empreendimentoId, caminhoPrefixo: item.sugestao.caminhoPrefixo, ...item.destino, liberarAutomatico: ehAdmin && item.liberar, ativa: true,
      });
      if (resposta.ok) salvas += 1;
      else restantes.push({ ...item, erro: resposta.erro ?? "Não foi possível salvar." });
    }
    setItens(restantes);
    setOcupado(false);
    const falhas = restantes.filter((item) => item.marcada).length;
    aoAvisar(`${salvas} regra(s) salva(s).${falhas > 0 ? ` ${falhas} não foi(ram) salva(s): veja o aviso em cada uma.` : ""}`);
    if (salvas > 0) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Button type="button" variant="outline" className="portal-botao" disabled={arvore.situacao !== "ok"} aria-describedby={arvore.situacao === "ok" ? undefined : "pasta-sem-arvore"} onClick={gerar}>
          <Sparkles aria-hidden="true" />Sugerir regras
        </Button>
        {arvore.situacao !== "ok" && <p id="pasta-sem-arvore" className="text-sm text-muted-foreground">{SEM_ARVORE[arvore.situacao]}</p>}
      </div>

      {itens && itens.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">Nenhuma pasta nova combinou com os nomes conhecidos (SAA, SES, PER, PEC, termo de acordo, ordem de serviço, doação, estrutural, proposta-contrato, orçamentos de 3). Adicione a regra manualmente, se precisar.</p>
      )}

      {itens && itens.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Confira cada sugestão, ajuste o destino e marque as que quer salvar. Nada é salvo antes de você clicar em “Salvar marcadas”.</p>
          <ul className="space-y-3">
            {itens.map((item, indice) => (
              <li key={item.sugestao.caminhoPrefixo} className="min-w-0 space-y-3 rounded-xl border bg-card p-5">
                <Caixa marcada={item.marcada} aoMudar={(marcada) => mudar(indice, { marcada })} desabilitada={ocupado}>
                  <span className="font-medium">{item.sugestao.caminhoPrefixo}</span>
                </Caixa>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{item.sugestao.motivo}{item.sugestao.pastaFinal ? " Subpasta final (aprovada, assinada ou em PDF)." : ""}</p>
                <EditorDeDestino id={`sugestao-${indice}`} valor={item.destino} aoMudar={(destino) => mudar(indice, { destino })} projetos={projetos} desabilitado={ocupado} />
                {ehAdmin && <Caixa marcada={item.liberar} aoMudar={(liberar) => mudar(indice, { liberar })} desabilitada={ocupado}>Liberar automático (só vale com a liberação automática do empreendimento ligada)</Caixa>}
                <MensagemDeErro>{item.erro}</MensagemDeErro>
              </li>
            ))}
          </ul>
          <Button type="button" className="portal-botao" disabled={ocupado} onClick={salvarMarcadas}><Save aria-hidden="true" />{ocupado ? "Salvando…" : "Salvar marcadas"}</Button>
        </div>
      )}
      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}
