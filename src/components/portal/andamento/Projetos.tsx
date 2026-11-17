import Link from "next/link";
import { Check, Files } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { montarGruposProjetos, obterSituacaoEtapa, type GrupoProjetos } from "@/lib/portal/andamento/regras";
import type { ProjetoPortal } from "@/lib/portal/andamento/tipos";
import type { UUID } from "@/lib/portal/comum/tipos";
import { GrupoRecolhivel } from "./GrupoRecolhivel";
import { ProgressoProjeto } from "./ProgressoProjeto";

function CartaoProjeto({ projeto, pai, empreendimentoId }: { projeto: ProjetoPortal; pai: ProjetoPortal | null; empreendimentoId: UUID }) {
  return (
    <Card className="portal-cartao portal-entrada">
      <h3>{projeto.nome}</h3>
      {pai && <p className="portal-depende">Depende de {pai.nome}</p>}
      <p>{projeto.progresso}% de andamento</p>
      <ProgressoProjeto nome={projeto.nome} progresso={projeto.progresso} />
      {!projeto.etapas.length ? <p>Etapas a definir</p> : (
        <ol className="portal-etapas">
          {[...projeto.etapas].sort((a, b) => a.ordem - b.ordem).map((etapa) => {
            const situacao = obterSituacaoEtapa(projeto.etapas, projeto.etapaAtualId, etapa.id);
            return (
              <li key={etapa.id} className="portal-etapa" aria-current={situacao === "atual" ? "step" : undefined}>
                <span className={`portal-etapa-marcador portal-etapa-${situacao}`} aria-hidden="true">
                  {situacao === "concluida" && <Check size={14} strokeWidth={3} />}
                </span>
                <div className="min-w-0 break-words">
                  <span className={situacao === "atual" ? "font-semibold" : undefined}>{etapa.nome}</span>
                  {situacao === "atual" ? <span className="portal-etapa-selo">Atual</span> : (
                    <span className="sr-only">{situacao === "concluida" ? " — Concluída" : " — Futura"}</span>
                  )}
                  {etapa.concluidaEm && <p className="text-xs">Concluída em {etapa.concluidaEm.split("-").reverse().join("/")}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Button asChild variant="outline" className="portal-botao portal-projeto-documentos">
        <Link prefetch={false}
          href={`/cliente/empreendimentos/${empreendimentoId}/documentos?projeto=${projeto.id}#projeto-${projeto.id}`}>
          <Files size={18} className="shrink-0" aria-hidden="true" />Ver documentos do projeto
          <span className="sr-only">: {projeto.nome}</span>
        </Link>
      </Button>
    </Card>
  );
}

function Grupo({ grupo, empreendimentoId }: { grupo: GrupoProjetos<ProjetoPortal>; empreendimentoId: UUID }) {
  const { projeto, pai, dependentes, totalDependentes } = grupo;
  const cartao = <CartaoProjeto projeto={projeto} pai={pai} empreendimentoId={empreendimentoId} />;
  if (!dependentes.length) return cartao;

  const etapaAtual = projeto.etapas.find((etapa) => etapa.id === projeto.etapaAtualId);
  return (
    <GrupoRecolhivel nome={projeto.nome} progresso={projeto.progresso} totalDependentes={totalDependentes}
      etapa={etapaAtual?.nome ?? (projeto.etapas.length ? "Etapa atual a definir" : "Etapas a definir")}>
      {cartao}
      <ul className="portal-arvore-filhos">
        {dependentes.map((dependente) => (
          <li key={dependente.projeto.id}><Grupo grupo={dependente} empreendimentoId={empreendimentoId} /></li>
        ))}
      </ul>
    </GrupoRecolhivel>
  );
}

export function Projetos({ projetos, empreendimentoId }: { projetos: ProjetoPortal[]; empreendimentoId: UUID }) {
  if (!projetos.length) return <p className="portal-vazio">Os projetos deste empreendimento serão apresentados aqui.</p>;

  return (
    <ul className="portal-arvore">
      {montarGruposProjetos(projetos).map((grupo) => (
        <li key={grupo.projeto.id}><Grupo grupo={grupo} empreendimentoId={empreendimentoId} /></li>
      ))}
    </ul>
  );
}
