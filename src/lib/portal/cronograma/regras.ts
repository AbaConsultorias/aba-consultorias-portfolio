import type { DataCivil } from "../comum/tipos";
import { compararParcelas, diferencaPrevisto, parcelaAguardaEvento, saldoDaParcela, situacaoVisualParcela, somarCentavos } from "../financeiro/regras";
import type { ItemFinanceiroPortal, ParcelaPortal } from "../financeiro/tipos";
import type { CelulaCronograma, Cronograma, LinhaCronograma, SituacaoCelula, TotaisCronograma } from "./tipos";

export const LIMITE_COLUNAS_CRONOGRAMA = 120;

const MESES_ABREVIADOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_COMPLETOS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const PADRAO_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function mesValido(valor: unknown): valor is string {
  return typeof valor === "string" && PADRAO_MES.test(valor);
}

export function rotuloMesAbreviado(mes: string): string {
  return MESES_ABREVIADOS[Number(mes.slice(5, 7)) - 1] ?? mes;
}

export function rotuloMesCompleto(mes: string): string {
  return `${MESES_COMPLETOS[Number(mes.slice(5, 7)) - 1] ?? mes} de ${mes.slice(0, 4)}`;
}

const indiceDoMes = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1;

function mesDoIndice(indice: number): string {
  const ano = Math.floor(indice / 12);
  return `${String(ano).padStart(4, "0")}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

function intervaloDeMeses(
  parcelas: readonly ParcelaPortal[],
  de: string | undefined,
  ate: string | undefined,
): { inicio: number; fim: number } | null {
  let menor: string | undefined;
  let maior: string | undefined;
  for (const parcela of parcelas) {
    const mes = parcela.vencimento?.slice(0, 7);
    if (!mesValido(mes)) continue;
    if (menor === undefined || mes < menor) menor = mes;
    if (maior === undefined || mes > maior) maior = mes;
  }
  let filtroDe = mesValido(de) ? de : undefined;
  let filtroAte = mesValido(ate) ? ate : undefined;
  if (filtroDe && filtroAte && filtroDe > filtroAte) [filtroDe, filtroAte] = [filtroAte, filtroDe];

  const inicioTexto = filtroDe ?? menor;
  const fimTexto = filtroAte ?? maior;
  if (inicioTexto === undefined && fimTexto === undefined) return null;
  let inicio = indiceDoMes((inicioTexto ?? fimTexto) as string);
  let fim = indiceDoMes((fimTexto ?? inicioTexto) as string);
  // Só um limite informado e os dados ficam do outro lado dele: mostra ao menos o mês pedido.
  if (inicio > fim) {
    if (filtroDe) fim = inicio;
    else inicio = fim;
  }
  return { inicio, fim };
}

function situacaoDaCelula(parcelas: readonly ParcelaPortal[], hoje: DataCivil): SituacaoCelula {
  const situacoes = parcelas.map((parcela) => situacaoVisualParcela(parcela, hoje));
  if (situacoes.every((situacao) => situacao === "quitada")) return "quitada";
  if (situacoes.includes("vencida")) return "vencida";
  const algumPagamento = parcelas.some((parcela, indice) => situacoes[indice] === "quitada"
    || BigInt(parcela.valorPagoCentavos) > BigInt(0));
  return algumPagamento ? "parcial" : "aberta";
}

function totaisDe(parcelas: readonly ParcelaPortal[]): TotaisCronograma {
  return {
    previstoCentavos: somarCentavos(parcelas.map((parcela) => parcela.valorPrevistoCentavos)),
    pagoCentavos: somarCentavos(parcelas.map((parcela) => parcela.valorPagoCentavos)),
    pendenteCentavos: somarCentavos(parcelas.map(saldoDaParcela)),
  };
}

export function montarCronograma(
  itens: readonly ItemFinanceiroPortal[],
  opcoes: { hoje: DataCivil; de?: string; ate?: string },
): Cronograma {
  const intervalo = intervaloDeMeses(itens.flatMap((item) => item.parcelas), opcoes.de, opcoes.ate);
  const meses: string[] = [];
  let truncado = false;
  if (intervalo) {
    truncado = intervalo.fim - intervalo.inicio + 1 > LIMITE_COLUNAS_CRONOGRAMA;
    const ultimo = Math.min(intervalo.fim, intervalo.inicio + LIMITE_COLUNAS_CRONOGRAMA - 1);
    for (let indice = intervalo.inicio; indice <= ultimo; indice += 1) meses.push(mesDoIndice(indice));
  }
  const noPeriodo = new Set(meses);

  const anos: Cronograma["anos"] = [];
  for (const mes of meses) {
    const ano = Number(mes.slice(0, 4));
    const ultimoAno = anos[anos.length - 1];
    if (ultimoAno?.ano === ano) ultimoAno.meses.push(mes);
    else anos.push({ ano, meses: [mes] });
  }

  const parcelasDoPeriodo: ParcelaPortal[] = [];
  const parcelasPorMes = new Map<string, ParcelaPortal[]>();
  const linhas = itens.map((item): LinhaCronograma => {
    const porMes = new Map<string, ParcelaPortal[]>();
    const doItem: ParcelaPortal[] = [];
    for (const parcela of item.parcelas) {
      const mes = parcela.vencimento?.slice(0, 7);
      if (mes === undefined || !noPeriodo.has(mes)) continue;
      porMes.set(mes, [...(porMes.get(mes) ?? []), parcela]);
      parcelasPorMes.set(mes, [...(parcelasPorMes.get(mes) ?? []), parcela]);
      doItem.push(parcela);
      parcelasDoPeriodo.push(parcela);
    }
    const celulas: Record<string, CelulaCronograma> = {};
    for (const [mes, parcelas] of porMes) {
      const ordenadas = [...parcelas].sort(compararParcelas);
      const totaisCelula = totaisDe(ordenadas);
      celulas[mes] = {
        mes,
        previstoCentavos: totaisCelula.previstoCentavos,
        pagoCentavos: totaisCelula.pagoCentavos,
        situacao: situacaoDaCelula(ordenadas, opcoes.hoje),
        parcelas: ordenadas,
      };
    }
    const totais = totaisDe(doItem);
    return {
      itemId: item.id,
      descricao: item.descricao,
      fornecedorNome: item.fornecedorNome,
      contratadoCentavos: item.valorContratadoCentavos,
      diferencaPrevistoCentavos: diferencaPrevisto(item.valorContratadoCentavos, item.parcelas),
      celulas,
      totalPrevistoCentavos: totais.previstoCentavos,
      totalPagoCentavos: totais.pagoCentavos,
      totalPendenteCentavos: totais.pendenteCentavos,
    };
  });

  const totaisPorMes: Record<string, TotaisCronograma> = {};
  for (const mes of meses) totaisPorMes[mes] = totaisDe(parcelasPorMes.get(mes) ?? []);

  const aguardando = itens.flatMap((item) => item.parcelas).filter(parcelaAguardaEvento);
  const aguardandoEvento = { quantidade: aguardando.length, pendenteCentavos: somarCentavos(aguardando.map(saldoDaParcela)) };

  return { meses, anos, linhas, totaisPorMes, totalGeral: totaisDe(parcelasDoPeriodo), aguardandoEvento, truncado };
}
