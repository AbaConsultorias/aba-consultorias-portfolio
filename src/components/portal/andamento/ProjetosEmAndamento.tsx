import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { ProjetoPortal } from "@/lib/portal/andamento/tipos";
import type { UUID } from "@/lib/portal/comum/tipos";
import { ProgressoProjeto } from "./ProgressoProjeto";

export function ProjetosEmAndamento({ projetos, empreendimentoId }: { projetos: ProjetoPortal[]; empreendimentoId: UUID }) {
  const emAndamento = projetos.filter((projeto) => projeto.progresso < 100);
  if (!emAndamento.length) {
    return <p className="portal-vazio">Não há projetos em andamento. Consulte a aba <Link className="underline underline-offset-4" prefetch={false} href={`/cliente/empreendimentos/${empreendimentoId}/projetos`}>Projetos</Link>.</p>;
  }

  return (
    <div className="portal-grade">
      {emAndamento.map((projeto) => {
        const etapaAtual = projeto.etapas.find((etapa) => etapa.id === projeto.etapaAtualId);
        const pai = projeto.projetoPaiId && projeto.projetoPaiId !== projeto.id ? projetos.find((candidato) => candidato.id === projeto.projetoPaiId) : undefined;
        return (
          <Card key={projeto.id} className="portal-cartao portal-projeto-compacto portal-entrada">
            <div className="portal-projeto-resumo">
              <h3>{projeto.nome}</h3>
              <span className="portal-projeto-percentual">{projeto.progresso}%</span>
            </div>
            {pai && <p className="portal-depende">Depende de {pai.nome}</p>}
            <p>{etapaAtual ?`Etapa atual: ${etapaAtual.nome}` : projeto.etapas.length ? "Etapa atual a definir" : "Etapas a definir"}</p>
            <ProgressoProjeto nome={projeto.nome} progresso={projeto.progresso} />
          </Card>
        );
      })}
    </div>
  );
}
