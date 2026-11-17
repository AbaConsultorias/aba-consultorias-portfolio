import "server-only";
import { avaliarUso, type AvaliacaoUso } from "@/lib/portal/conector/uso";
import { obterUsoDoBalde } from "@/lib/portal/conector/uso-r2";

export type UsoDoR2 = AvaliacaoUso & { objetos: number; parcial: boolean; calculadoEm: string };

export async function consultarUso(): Promise<UsoDoR2> {
  const { bytes, objetos, parcial, calculadoEm } = await obterUsoDoBalde();
  return { ...avaliarUso(bytes), objetos, parcial, calculadoEm };
}
