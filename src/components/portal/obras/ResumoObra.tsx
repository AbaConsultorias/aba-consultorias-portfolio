import { rotuloSituacao } from "@/lib/portal/obras/regras";
import { SeloSituacao } from "@/components/portal/comum/SeloSituacao";
import type { ObraEmpreiteiro } from "@/lib/portal/obras/tipos";

const data = (valor: string | null) => valor ? valor.split("-").reverse().join("/") : "Não informado";
export function ResumoObra({ obra }: { obra: ObraEmpreiteiro }) {
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{obra.empreendimentoNome ?? "Empreendimento"}</p>
    <div className="obras-resumo"><SeloSituacao situacao={obra.situacao}>{rotuloSituacao(obra.situacao)}</SeloSituacao><strong>{obra.percentual}% oficial</strong></div>
    <div className="portal-progresso" role="progressbar" aria-label="Progresso oficial da obra" aria-valuemin={0} aria-valuemax={100} aria-valuenow={obra.percentual}><span className="portal-progresso-preenchimento" style={{ transform: `scaleX(${obra.percentual / 100})` }} /></div>
    <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Início previsto</dt><dd>{data(obra.previstoInicio)}</dd></div><div><dt className="text-muted-foreground">Fim previsto</dt><dd>{data(obra.previstoFim)}</dd></div></dl>
    <p className="text-sm text-muted-foreground">{obra.relatosPendentes} {obra.relatosPendentes === 1 ? "relato pendente" : "relatos pendentes"}</p>
  </div>;
}
