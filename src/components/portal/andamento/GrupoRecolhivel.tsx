"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { textoDependentes } from "@/lib/portal/andamento/regras";

// Projeto com dependentes: começa recolhido, só com uma linha de resumo; o botão mostra o cartão completo e os
// dependentes (children). O conteúdo continua no HTML, escondido por `hidden`.
export function GrupoRecolhivel({ nome, etapa, progresso, totalDependentes, children }: {
  nome: string; etapa: string | null; progresso: number; totalDependentes: number; children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const idConteudo = useId();

  return (
    <div className="portal-recolhivel">
      <button type="button" className="portal-recolhivel-botao" aria-expanded={aberto} aria-controls={idConteudo} onClick={() => setAberto(!aberto)}>
        <ChevronDown className="portal-recolhivel-icone" size={20} aria-hidden="true" />
        {aberto ? (
          <span className="portal-recolhivel-recolher">Recolher<span className="sr-only"> {nome} e seus dependentes</span></span>
        ) : (
          <span className="portal-recolhivel-resumo">
            <span className="portal-recolhivel-nome">{nome}</span>
            {etapa && <span className="portal-etapa-selo">{etapa}</span>}
            <span className="portal-projeto-percentual">{progresso}%<span className="sr-only"> de andamento</span></span>
            <span className="portal-recolhivel-dependentes">{textoDependentes(totalDependentes)}</span>
          </span>
        )}
      </button>
      <div id={idConteudo} className="portal-recolhivel-conteudo" hidden={!aberto}>{children}</div>
    </div>
  );
}
