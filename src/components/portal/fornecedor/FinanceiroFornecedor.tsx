import { agruparPorEmpreendimento } from "@/lib/portal/fornecedor/regras";
import type { ItemFornecedor } from "@/lib/portal/fornecedor/tipos";
import type { ResumoFinanceiro } from "@/lib/portal/financeiro/tipos";
import { dataCivilDeHoje, formatarBRL, formatarDataCivil, nomeParcela, situacaoVisualParcela } from "@/lib/portal/financeiro/regras";
import { SeloParcela } from "@/components/portal/financeiro/SeloSituacaoFinanceira";
import { RolagemLateral } from "@/components/portal/comum/RolagemLateral";
import "@/components/portal/financeiro/financeiro.css";

export function FinanceiroFornecedor({ itens, resumo }: { itens: ItemFornecedor[]; resumo: ResumoFinanceiro }) {
  if (!itens.length) return <p className="portal-vazio">Ainda não há parcelas ou itens cadastrados para você. Fale com a equipe ABA se precisar de ajuda.</p>;
  const hoje = dataCivilDeHoje();
  return <>
    <dl className="fin-resumo"><div className="fin-indicador"><dt>Contratado</dt><dd>{formatarBRL(resumo.contratadoCentavos)}</dd></div><div className="fin-indicador"><dt>Pago</dt><dd>{formatarBRL(resumo.pagoCentavos)}</dd></div><div className="fin-indicador"><dt>Saldo</dt><dd>{formatarBRL(resumo.saldoCentavos)}</dd></div><div className="fin-indicador"><dt>Próximo vencimento</dt><dd>{resumo.proximoPagamento ? formatarDataCivil(resumo.proximoPagamento.vencimento) : "Sem pendências"}</dd></div></dl>
    {agruparPorEmpreendimento(itens).map((grupo) => <section className="portal-secao" key={grupo.empreendimentoId}>
      <h2>{grupo.empreendimentoNome ?? "Empreendimento"}</h2>
      <div className="forn-lista">{grupo.itens.map((item) => <article className="forn-caixa" key={item.id}>
        <h3>{item.descricao}</h3><p className="forn-ajuda">{item.fornecedorNome} · Contratado: {formatarBRL(item.valorContratadoCentavos)}</p>
        {item.observacao && <p className="forn-observacao"><strong>Condições de pagamento:</strong> {item.observacao}</p>}
        {!item.parcelas.length ? <p>Nenhuma parcela cadastrada.</p> : <RolagemLateral className="fin-tabela-wrap" rotulo={`Parcelas de ${item.descricao}`}><table className="fin-tabela"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Previsto</th><th>Pago</th><th>Situação</th><th>Condições</th></tr></thead><tbody>{item.parcelas.map((parcela, i) => <tr key={parcela.id} data-estado={situacaoVisualParcela(parcela, hoje)}><td>{nomeParcela(parcela, i + 1)}</td><td>{parcela.vencimento ? formatarDataCivil(parcela.vencimento) : "A definir"}</td><td>{formatarBRL(parcela.valorPrevistoCentavos)}</td><td>{formatarBRL(parcela.valorPagoCentavos)}</td><td><SeloParcela parcela={parcela} hoje={hoje} /></td><td className="forn-condicao">{parcela.observacao ?? "—"}</td></tr>)}</tbody></table></RolagemLateral>}
      </article>)}</div>
    </section>)}
  </>;
}
