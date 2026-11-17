import type { Centavos } from "../comum/tipos";
import type { ParcelaPortal } from "../financeiro/tipos";

export type SituacaoCelula = "quitada" | "parcial" | "aberta" | "vencida";

export type CelulaCronograma = {
  mes: string;
  previstoCentavos: Centavos;
  pagoCentavos: Centavos;
  situacao: SituacaoCelula;
  parcelas: ParcelaPortal[];
};

export type TotaisCronograma = {
  previstoCentavos: Centavos;
  pagoCentavos: Centavos;
  pendenteCentavos: Centavos;
};

export type LinhaCronograma = {
  itemId: string;
  descricao: string;
  fornecedorNome: string | null;
  contratadoCentavos: Centavos;
  diferencaPrevistoCentavos: Centavos;
  celulas: Record<string, CelulaCronograma>;
  totalPrevistoCentavos: Centavos;
  totalPagoCentavos: Centavos;
  totalPendenteCentavos: Centavos;
};

export type Cronograma = {
  meses: string[];
  anos: { ano: number; meses: string[] }[];
  linhas: LinhaCronograma[];
  totaisPorMes: Record<string, TotaisCronograma>;
  totalGeral: TotaisCronograma;
  // Parcelas sem vencimento (aguardam um evento) ficam fora dos meses.
  aguardandoEvento: { quantidade: number; pendenteCentavos: Centavos };
  truncado: boolean;
};
