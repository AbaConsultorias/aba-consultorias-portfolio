"use client";

import { useState } from "react";
import type { DadosDaPasta } from "@/lib/portal/pasta/tipos";
import { ConfiguracaoDaPasta } from "./ConfiguracaoDaPasta";
import { EtapasPelasPastas } from "./EtapasPelasPastas";
import { ListaDeRegras } from "./ListaDeRegras";
import { MontagemDoServidor } from "./MontagemDoServidor";
import { NovaRegra } from "./NovaRegra";
import { Sugestoes } from "./Sugestoes";

type Props = {
  adminPath: string;
  empreendimentoId: string;
  codigoPasta: string | null;
  liberacaoAutomatica: boolean;
  dados: DadosDaPasta;
  // Os interruptores de liberação automática e a edição do que já está ligado são só do admin.
  ehAdmin: boolean;
  // Montar pede empreendimentos.editar e servidor.regras; a chave dos complementares, só empreendimentos.editar.
  podeEditar: boolean;
  lerComplementares: boolean;
};

export function SecaoPastaServidor({ adminPath, empreendimentoId, codigoPasta, liberacaoAutomatica, dados, ehAdmin, podeEditar, lerComplementares }: Props) {
  const [mensagem, setMensagem] = useState("");
  const { regras, projetos, arvore, liberacaoGeral } = dados;
  return (
    <section aria-labelledby="pasta-servidor-titulo" className="min-w-0 space-y-6">
      <div>
        <h2 id="pasta-servidor-titulo" className="text-xl font-medium">Pasta do servidor</h2>
        <p className="mt-1 text-sm text-muted-foreground">O programa do servidor envia os PDFs das pastas com regra. Todo arquivo chega oculto, a menos que a liberação automática se aplique.</p>
      </div>
      <ConfiguracaoDaPasta adminPath={adminPath} empreendimentoId={empreendimentoId} codigoPasta={codigoPasta} liberacaoAutomatica={liberacaoAutomatica} liberacaoGeral={liberacaoGeral} ehAdmin={ehAdmin} aoAvisar={setMensagem} />
      <EtapasPelasPastas adminPath={adminPath} empreendimentoId={empreendimentoId} modo={dados.etapasModo} podeEditar={podeEditar} ehAdmin={ehAdmin} aoAvisar={setMensagem} />
      <MontagemDoServidor adminPath={adminPath} empreendimentoId={empreendimentoId} podeMontar={podeEditar} podeEditar={podeEditar} ehAdmin={ehAdmin} lerComplementares={lerComplementares} aoAvisar={setMensagem} />
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Regras de pasta</h3>
        <ListaDeRegras adminPath={adminPath} regras={regras} projetos={projetos} ehAdmin={ehAdmin} aoAvisar={setMensagem} />
        <Sugestoes adminPath={adminPath} empreendimentoId={empreendimentoId} arvore={arvore} projetos={projetos} regras={regras} ehAdmin={ehAdmin} aoAvisar={setMensagem} />
        <NovaRegra adminPath={adminPath} empreendimentoId={empreendimentoId} projetos={projetos} ehAdmin={ehAdmin} aoAvisar={setMensagem} />
      </div>
      <p role="status" aria-live="polite" className="text-sm">{mensagem}</p>
    </section>
  );
}
