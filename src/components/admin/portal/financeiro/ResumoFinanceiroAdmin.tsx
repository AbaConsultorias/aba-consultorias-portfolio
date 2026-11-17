import { formatarBRL, formatarDataCivil } from "@/lib/portal/financeiro/regras";
import type { ResumoFinanceiro } from "@/lib/portal/financeiro/tipos";
import "@/components/portal/financeiro/financeiro.css";

export function ResumoFinanceiroAdmin({ resumo }: { resumo: ResumoFinanceiro }) {
  return (
    <dl className="fin-resumo">
      <div className="fin-indicador"><dt>Contratado</dt><dd>{formatarBRL(resumo.contratadoCentavos)}</dd></div>
      <div className="fin-indicador"><dt>Pago</dt><dd>{formatarBRL(resumo.pagoCentavos)}</dd></div>
      <div className="fin-indicador"><dt>Saldo</dt><dd className={BigInt(resumo.saldoCentavos) < BigInt(0) ? "fin-negativo" : undefined}>{formatarBRL(resumo.saldoCentavos)}</dd></div>
      <div className="fin-indicador">
        <dt>Próximo vencimento</dt>
        <dd>{resumo.proximoPagamento ? formatarDataCivil(resumo.proximoPagamento.vencimento) : "Sem pendências"}</dd>
      </div>
    </dl>
  );
}
