import type { CSSProperties } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import {
  DIAS_VENCE_EM_BREVE, formatarBRL, formatarDataCivil, nomeDoProjetoDaParcela, nomeParcela, numeroDaParcela, parcelaEmAtraso, parcelasAVencer,
  parcelaVenceEmBreve, rotuloDoContrato, saldoDaParcela, situacaoDoItem, situacaoVisualParcela, somarCentavos,
} from "@/lib/portal/financeiro/regras";
import type { ItemFinanceiroPortal, ParcelaPortal, ResumoFinanceiro } from "@/lib/portal/financeiro/tipos";
import { RolagemLateral } from "@/components/portal/comum/RolagemLateral";
import { ResumoItemFinanceiro } from "./ResumoItemFinanceiro";
import { SeloParcela, SeloSituacaoFinanceira } from "./SeloSituacaoFinanceira";
import { VencimentoParcela } from "./VencimentoParcela";
import "./financeiro.css";

const ordem = (n: number) => ({ "--ordem": n }) as CSSProperties;

function AvisoAtraso({ parcelas, hoje }: { parcelas: readonly ParcelaPortal[]; hoje: string }) {
  const atrasadas = parcelas.filter((parcela) => parcelaEmAtraso(parcela, hoje));
  if (atrasadas.length === 0) return null;
  const valor = somarCentavos(atrasadas.map(saldoDaParcela));
  return (
    <p className="fin-aviso fin-animado" data-estado="vencida" role="status">
      <TriangleAlert size={20} aria-hidden="true" />
      <span>
        {atrasadas.length === 1 ? "Há 1 parcela vencida" : `Há ${atrasadas.length} parcelas vencidas`} e ainda sem quitação
        registrada, somando {formatarBRL(valor)} em aberto. Se o pagamento já foi feito, fale com a equipe para atualizarmos o registro.
      </span>
    </p>
  );
}

function ProximosPagamentos({ itens, hoje }: { itens: readonly ItemFinanceiroPortal[]; hoje: string }) {
  const proximos = itens
    .flatMap((item) => parcelasAVencer(item.parcelas, hoje).map((parcela) => {
      const posicao = item.parcelas.findIndex((candidata) => candidata.id === parcela.id) + 1;
      return { item, parcela, posicao };
    }))
    .sort((a, b) => a.parcela.vencimento.localeCompare(b.parcela.vencimento) || a.parcela.id.localeCompare(b.parcela.id));
  if (proximos.length === 0) return null;
  return (
    <section className="fin-proximos fin-animado" aria-labelledby="titulo-proximos-pagamentos">
      <h2 id="titulo-proximos-pagamentos"><CalendarClock size={20} aria-hidden="true" />Próximos pagamentos</h2>
      <p className="fin-proximos-ajuda">Parcelas que vencem nos próximos {DIAS_VENCE_EM_BREVE} dias.</p>
      <ul>
        {proximos.map(({ item, parcela, posicao }) => (
          <li key={parcela.id}>
            <span className="fin-proximo-data">{formatarDataCivil(parcela.vencimento)}</span>
            <span className="fin-proximo-descricao">
              <strong>{rotuloDoContrato(item)}</strong>
              <small>{nomeParcela(parcela, posicao)} · parcela {numeroDaParcela(parcela, posicao, item.parcelas.length)}</small>
            </span>
            <span className="fin-proximo-valor">{formatarBRL(saldoDaParcela(parcela))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CartaoItem({ item, hoje, indice }: { item: ItemFinanceiroPortal; hoje: string; indice: number }) {
  const situacao = situacaoDoItem(item, hoje);
  return (
    <details className="fin-item fin-animado" data-estado={situacao} style={ordem(indice)} open={situacao === "atraso"}>
      <ResumoItemFinanceiro item={item} hoje={hoje} />
      <div className="fin-item-conteudo">
        {item.observacao && <p className="fin-observacao">{item.observacao}</p>}
        {item.parcelas.length === 0 ? (
          <p className="fin-observacao">Nenhuma parcela cadastrada para este item.</p>
        ) : (
          <RolagemLateral className="fin-tabela-wrap" rotulo={`Parcelas de ${item.descricao}`}>
            <table className="fin-tabela fin-tabela-numerada">
              <thead><tr><th>Nº</th><th>Parcela</th><th>Vencimento</th><th>Previsto</th><th>Pago</th><th>Situação</th></tr></thead>
              <tbody>
                {item.parcelas.map((parcela, indiceParcela) => (
                  <tr key={parcela.id} data-estado={situacaoVisualParcela(parcela, hoje)}>
                    <td>{numeroDaParcela(parcela, indiceParcela + 1, item.parcelas.length)}</td>
                    <td className="fin-nome-parcela">{nomeParcela(parcela, indiceParcela + 1)}</td>
                    <td className="fin-vencimento"><VencimentoParcela parcela={parcela} nomeProjeto={nomeDoProjetoDaParcela(item, parcela)} /></td>
                    <td>{formatarBRL(parcela.valorPrevistoCentavos)}</td>
                    <td>{formatarBRL(parcela.valorPagoCentavos)}</td>
                    <td><SeloParcela parcela={parcela} hoje={hoje} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RolagemLateral>
        )}
      </div>
    </details>
  );
}

export function PainelFinanceiro({ itens, resumo, hoje }: {
  itens: readonly ItemFinanceiroPortal[];
  resumo: ResumoFinanceiro;
  hoje: string;
}) {
  if (itens.length === 0) {
    return (
      <section className="portal-vazio fin-animado">
        <h2>Nenhum lançamento financeiro ainda</h2>
        <p>Quando a equipe registrar valores contratados e parcelas deste empreendimento, eles aparecerão aqui.</p>
      </section>
    );
  }
  const proximo = resumo.proximoPagamento;
  const destaqueProximo = proximo && parcelaEmAtraso(proximo, hoje) ? "vencida"
    : proximo && parcelaVenceEmBreve(proximo, hoje) ? "vence-em-breve" : undefined;
  const negativo = BigInt(resumo.saldoCentavos) < BigInt(0);
  return (
    <>
      <AvisoAtraso parcelas={itens.flatMap((item) => item.parcelas)} hoje={hoje} />
      <ProximosPagamentos itens={itens} hoje={hoje} />
      <dl className="fin-resumo">
        <div className="fin-indicador fin-animado" style={ordem(0)}><dt>Contratado</dt><dd>{formatarBRL(resumo.contratadoCentavos)}</dd></div>
        <div className="fin-indicador fin-animado" style={ordem(1)}><dt>Pago</dt><dd>{formatarBRL(resumo.pagoCentavos)}</dd></div>
        <div className="fin-indicador fin-animado" style={ordem(2)}>
          <dt>Saldo</dt>
          <dd className={negativo ? "fin-negativo" : undefined}>{formatarBRL(resumo.saldoCentavos)}</dd>
          {negativo && <small>Os pagamentos registrados superam o valor contratado.</small>}
        </div>
        <div className={`fin-indicador fin-animado${destaqueProximo ? " fin-destaque" : ""}`} data-estado={destaqueProximo} style={ordem(3)}>
          <dt>Próximo vencimento</dt>
          <dd>{proximo ? formatarDataCivil(proximo.vencimento) : "Sem pendências"}</dd>
          {proximo && <small>{formatarBRL(proximo.valorPrevistoCentavos)}</small>}
          {destaqueProximo && <SeloSituacaoFinanceira situacao={destaqueProximo} />}
        </div>
      </dl>
      <section className="portal-secao">
        <h2>Itens e parcelas</h2>
        <ul className="fin-legenda" aria-label="Legenda das cores das parcelas">
          <li className="fin-legenda-titulo">Legenda:</li>
          <li><SeloSituacaoFinanceira situacao="aberta" /></li>
          <li><SeloSituacaoFinanceira situacao="vence-em-breve" /></li>
          <li><SeloSituacaoFinanceira situacao="vencida" /></li>
          <li><SeloSituacaoFinanceira situacao="parcial" /></li>
          <li><SeloSituacaoFinanceira situacao="aguarda-evento" /></li>
          <li><SeloSituacaoFinanceira situacao="quitada" /></li>
        </ul>
        <div className="fin-itens">
          {itens.map((item, indice) => <CartaoItem key={item.id} item={item} hoje={hoje} indice={indice} />)}
        </div>
      </section>
    </>
  );
}
