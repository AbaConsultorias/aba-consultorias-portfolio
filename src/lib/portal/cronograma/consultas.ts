import "server-only";
import type { UUID } from "../comum/tipos";
import { obterFinanceiro } from "../financeiro/consultas";
import { dataCivilDeHoje } from "../financeiro/regras";
import { montarCronograma } from "./regras";
import type { Cronograma } from "./tipos";

export async function obterCronograma(
  empreendimentoId: UUID,
  filtro: { de?: string; ate?: string } = {},
): Promise<Cronograma> {
  const { itens } = await obterFinanceiro(empreendimentoId);
  return montarCronograma(itens, { hoje: dataCivilDeHoje(), ...filtro });
}
