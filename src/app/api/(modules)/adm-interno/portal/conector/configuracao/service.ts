import "server-only";
import { gravarLiberacaoAutomaticaGeral, lerLiberacaoAutomaticaGeral } from "@/lib/portal/conector/consultas";
import { createClient } from "@/lib/supabase/server";
import type { AlterarInput } from "./schema";

export type ConfiguracaoDoConector = { liberacaoAutomaticaGeral: boolean };

export async function obterConfiguracao(): Promise<ConfiguracaoDoConector> {
  return { liberacaoAutomaticaGeral: await lerLiberacaoAutomaticaGeral(await createClient()) };
}

export async function alterarConfiguracao({ liberacaoAutomaticaGeral }: AlterarInput): Promise<ConfiguracaoDoConector> {
  return { liberacaoAutomaticaGeral: await gravarLiberacaoAutomaticaGeral(await createClient(), liberacaoAutomaticaGeral) };
}
