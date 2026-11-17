import { ChevronDown } from "lucide-react";
import { calcularSaldo, formatarBRL, rotuloDoContrato, situacaoDoItem, somarPagamentos } from "@/lib/portal/financeiro/regras";
import type { ItemFinanceiroPortal } from "@/lib/portal/financeiro/tipos";
import { SeloSituacaoFinanceira } from "./SeloSituacaoFinanceira";

export function ResumoItemFinanceiro({ item, hoje }: { item: ItemFinanceiroPortal; hoje: string }) {
  const saldo = calcularSaldo(item.valorContratadoCentavos, item.parcelas);
  const situacao = situacaoDoItem(item, hoje);
  const ehContrato = item.codigo !== null;
  return (
    <summary className="fin-item-resumo">
      <span className="fin-item-identificacao">
        <span className="fin-item-nome" role="heading" aria-level={3}>{rotuloDoContrato(item)}</span>
        {!ehContrato && <span className="fin-fornecedor">{item.fornecedorNome ? `Fornecedor: ${item.fornecedorNome}` : "Sem fornecedor informado"}</span>}
        <SeloSituacaoFinanceira situacao={situacao} />
      </span>
      <span className="fin-valores">
        <span>Contratado<strong>{formatarBRL(item.valorContratadoCentavos)}</strong></span>
        <span>Pago<strong>{formatarBRL(somarPagamentos(item.parcelas))}</strong></span>
        <span>Saldo<strong className={BigInt(saldo) < BigInt(0) ? "fin-negativo" : undefined}>{formatarBRL(saldo)}</strong></span>
      </span>
      <ChevronDown className="fin-item-chevron" size={20} aria-hidden="true" />
    </summary>
  );
}
