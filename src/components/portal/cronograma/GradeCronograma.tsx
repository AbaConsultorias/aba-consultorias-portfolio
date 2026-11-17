import Link from "next/link";
import { CircleCheck, CircleDashed, CircleDollarSign, TriangleAlert, X } from "lucide-react";
import { formatarBRL, formatarDataCivil, nomeParcela, saldoDaParcela } from "@/lib/portal/financeiro/regras";
import { RolagemLateral } from "@/components/portal/comum/RolagemLateral";
import { BotaoCelula } from "./BotaoCelula";
import { LIMITE_COLUNAS_CRONOGRAMA, mesValido, rotuloMesAbreviado, rotuloMesCompleto } from "@/lib/portal/cronograma/regras";
import type { CelulaCronograma, Cronograma, SituacaoCelula } from "@/lib/portal/cronograma/tipos";
import "./cronograma.css";

const SITUACOES = {
  quitada: { Icone: CircleCheck, rotulo: "Quitada", ajuda: "Todas as parcelas do mês estão pagas" },
  parcial: { Icone: CircleDollarSign, rotulo: "Parcial", ajuda: "Parte do mês já foi paga" },
  aberta: { Icone: CircleDashed, rotulo: "A pagar", ajuda: "Ainda dentro do prazo, sem pagamento" },
  vencida: { Icone: TriangleAlert, rotulo: "Vencida", ajuda: "Prazo vencido e sem quitação registrada" },
} as const satisfies Record<SituacaoCelula, { Icone: typeof CircleCheck; rotulo: string; ajuda: string }>;

function Legenda() {
  return (
    <ul className="cron-legenda" aria-label="Legenda das cores">
      <li className="cron-legenda-titulo">Legenda:</li>
      {(Object.keys(SITUACOES) as SituacaoCelula[]).map((situacao) => {
        const { Icone, rotulo, ajuda } = SITUACOES[situacao];
        return (
          <li key={situacao} className="cron-selo" data-estado={situacao} title={ajuda}>
            <Icone size={14} aria-hidden="true" />{rotulo}
          </li>
        );
      })}
    </ul>
  );
}

function DetalheCelula({ id, item, mes, celula }: { id: string; item: string; mes: string; celula: CelulaCronograma }) {
  return (
    <div id={id} popover="auto" className="cron-detalhe" data-estado={celula.situacao}>
      <div className="cron-detalhe-topo">
        <div>
          <p className="cron-detalhe-item">{item}</p>
          <p className="cron-detalhe-mes">{rotuloMesCompleto(mes)}</p>
        </div>
        <button type="button" popoverTarget={id} popoverTargetAction="hide" className="cron-detalhe-fechar" aria-label="Fechar detalhes">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ul className="cron-detalhe-lista">
        {celula.parcelas.map((parcela, indice) => {
          const pago = BigInt(parcela.valorPagoCentavos);
          return (
            <li key={parcela.id}>
              <p className="cron-detalhe-nome">{nomeParcela(parcela, indice + 1)}</p>
              <dl>
                <div><dt>Vencimento</dt><dd>{parcela.vencimento ? formatarDataCivil(parcela.vencimento) : "—"}</dd></div>
                <div><dt>Previsto</dt><dd>{formatarBRL(parcela.valorPrevistoCentavos)}</dd></div>
                <div><dt>Pago</dt><dd>{pago > BigInt(0) ? formatarBRL(parcela.valorPagoCentavos) : "—"}{parcela.dataPagamento ? ` em ${formatarDataCivil(parcela.dataPagamento)}` : ""}</dd></div>
                <div><dt>Falta pagar</dt><dd>{formatarBRL(saldoDaParcela(parcela))}</dd></div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CelulaMes({ celula, itemId, item, mes }: { celula: CelulaCronograma | undefined; itemId: string; item: string; mes: string }) {
  if (!celula) {
    return (
      <td className="cron-celula cron-vazia">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Sem parcela</span>
      </td>
    );
  }
  const { Icone, rotulo } = SITUACOES[celula.situacao];
  const id = `cron-${itemId}-${mes}`;
  const mostraPago = celula.situacao !== "quitada" && BigInt(celula.pagoCentavos) > BigInt(0);
  return (
    <td className="cron-celula" data-estado={celula.situacao}>
      <BotaoCelula alvo={id} rotulo={`${item}, ${rotuloMesCompleto(mes)}: ${formatarBRL(celula.previstoCentavos)}, ${rotulo}. Ver parcelas`}>
        <span className="cron-valor">{formatarBRL(celula.previstoCentavos)}</span>
        <span className="cron-rotulo"><Icone size={12} aria-hidden="true" />{rotulo}</span>
        {mostraPago && <span className="cron-pago">Pago {formatarBRL(celula.pagoCentavos)}</span>}
      </BotaoCelula>
      <DetalheCelula id={id} item={item} mes={mes} celula={celula} />
    </td>
  );
}

function ValoresTotais({ previsto, pago, pendente }: { previsto: string; pago: string; pendente: string }) {
  return (
    <>
      <td className="cron-total cron-total-primeira"><span className="cron-valor">{formatarBRL(previsto)}</span></td>
      <td className="cron-total">{formatarBRL(pago)}</td>
      <td className="cron-total">{formatarBRL(pendente)}</td>
    </>
  );
}

function FiltroPeriodo({ de, ate, hrefLimpar, camposOcultos }: {
  de: string | undefined;
  ate: string | undefined;
  hrefLimpar: string;
  camposOcultos: Record<string, string>;
}) {
  return (
    <form method="get" className="cron-filtro" aria-label="Filtrar período">
      {Object.entries(camposOcultos).map(([nome, valor]) => <input key={nome} type="hidden" name={nome} value={valor} />)}
      <label>De<input type="month" name="de" defaultValue={de ?? ""} /></label>
      <label>Até<input type="month" name="ate" defaultValue={ate ?? ""} /></label>
      <button type="submit" className="cron-botao">Filtrar</button>
      {(de || ate) && <Link href={hrefLimpar} prefetch={false} className="cron-limpar">Limpar filtro</Link>}
    </form>
  );
}

export function GradeCronograma({ cronograma, de, ate, hrefLimpar, camposOcultos = {} }: {
  cronograma: Cronograma;
  de?: string;
  ate?: string;
  hrefLimpar: string;
  camposOcultos?: Record<string, string>;
}) {
  const { meses, anos, linhas, totaisPorMes, totalGeral, aguardandoEvento, truncado } = cronograma;
  const filtroDe = mesValido(de) ? de : undefined;
  const filtroAte = mesValido(ate) ? ate : undefined;

  if (linhas.length === 0) {
    return (
      <div className="portal-vazio">
        <h2>Nenhum item financeiro cadastrado</h2>
        <p>Assim que a equipe da ABA lançar os itens e parcelas, o cronograma de pagamentos aparece aqui.</p>
      </div>
    );
  }

  return (
    <div className="cron">
      <FiltroPeriodo de={filtroDe} ate={filtroAte} hrefLimpar={hrefLimpar} camposOcultos={camposOcultos} />
      <Legenda />
      {truncado && (
        <p className="cron-aviso" role="status">
          O período tem mais de {LIMITE_COLUNAS_CRONOGRAMA} meses. Mostramos os primeiros {LIMITE_COLUNAS_CRONOGRAMA}; use o filtro para ver os demais.
        </p>
      )}
      {meses.length === 0 ? (
        <div className="portal-vazio">
          <h2>Nenhuma parcela cadastrada</h2>
          <p>Os itens já existem, mas ainda não têm parcelas com vencimento.</p>
        </div>
      ) : (
        <RolagemLateral className="cron-rolagem" sombraInicio={false}
          rotulo="Cronograma de pagamentos por mês. Role para os lados para ver todos os meses.">
          <table className="cron-tabela">
            <caption className="sr-only">Parcelas previstas por item e por mês de vencimento</caption>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="cron-item-cabecalho">Item</th>
                {anos.map(({ ano, meses: mesesDoAno }) => (
                  <th key={ano} scope="colgroup" colSpan={mesesDoAno.length} className="cron-ano"><span className="cron-ano-rotulo">{ano}</span></th>
                ))}
                <th scope="colgroup" colSpan={3} className="cron-ano cron-total-cabecalho">Total do item</th>
              </tr>
              <tr>
                {meses.map((mes) => (
                  <th key={mes} scope="col" className="cron-mes">
                    {rotuloMesAbreviado(mes)}<span className="sr-only"> ({rotuloMesCompleto(mes)})</span>
                  </th>
                ))}
                <th scope="col" className="cron-mes cron-total-cabecalho cron-total-primeira">Previsto</th>
                <th scope="col" className="cron-mes cron-total-cabecalho">Pago</th>
                <th scope="col" className="cron-mes cron-total-cabecalho">A pagar</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const diferenca = BigInt(linha.diferencaPrevistoCentavos);
                return (
                  <tr key={linha.itemId}>
                    <th scope="row" className="cron-item">
                      <span className="cron-item-nome">{linha.descricao}</span>
                      {linha.fornecedorNome && <span className="cron-item-detalhe">{linha.fornecedorNome}</span>}
                      <span className="cron-item-detalhe">Contratado: {formatarBRL(linha.contratadoCentavos)}</span>
                      {diferenca !== BigInt(0) && (
                        <span className="cron-item-detalhe">
                          {diferenca > BigInt(0)
                            ? `Falta programar ${formatarBRL(linha.diferencaPrevistoCentavos)}`
                            : `Programado a mais: ${formatarBRL((-diferenca).toString())}`}
                        </span>
                      )}
                    </th>
                    {meses.map((mes) => <CelulaMes key={mes} celula={linha.celulas[mes]} itemId={linha.itemId} item={linha.descricao} mes={mes} />)}
                    <ValoresTotais previsto={linha.totalPrevistoCentavos} pago={linha.totalPagoCentavos} pendente={linha.totalPendenteCentavos} />
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="cron-linha-total">
                <th scope="row" className="cron-item">Total do mês<span className="cron-item-detalhe">Previsto · pago · a pagar</span></th>
                {meses.map((mes) => {
                  const totais = totaisPorMes[mes];
                  return (
                    <td key={mes} className="cron-celula cron-soma">
                      <span className="cron-valor">{formatarBRL(totais.previstoCentavos)}</span>
                      <span>{formatarBRL(totais.pagoCentavos)}</span>
                      <span>{formatarBRL(totais.pendenteCentavos)}</span>
                    </td>
                  );
                })}
                <ValoresTotais previsto={totalGeral.previstoCentavos} pago={totalGeral.pagoCentavos} pendente={totalGeral.pendenteCentavos} />
              </tr>
            </tfoot>
          </table>
        </RolagemLateral>
      )}
      {aguardandoEvento.quantidade > 0 && (
        <p className="cron-aviso" role="status">
          Aguardando evento: {aguardandoEvento.quantidade === 1 ? "1 parcela" : `${aguardandoEvento.quantidade} parcelas`} sem
          data de vencimento, somando {formatarBRL(aguardandoEvento.pendenteCentavos)} a pagar. Elas entram no mês assim que o evento acontecer.
        </p>
      )}
      <p className="cron-nota">
        Cada valor aparece no mês do vencimento previsto, mesmo que o pagamento tenha sido feito em outra data.
        Toque num mês (ou pare o mouse sobre ele) para ver as parcelas.
      </p>
    </div>
  );
}
