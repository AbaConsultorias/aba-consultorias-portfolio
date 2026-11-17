import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { conferirErro } from "@/lib/portal/obras/erros";
import { listarFilaRelatos } from "@/lib/portal/obras/consultas";
import * as schemas from "./schema";

export const listar = (entrada: z.infer<typeof schemas.consultaSchema>) => listarFilaRelatos(entrada, entrada);
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>) {
  const sessao = await createClient();
  const { error } = await sessao.rpc("revisar_relato_obra", {
    p_relato: entrada.id, p_acao: entrada.acao,
    p_motivo: entrada.acao === "devolver" ? entrada.motivo : null,
    p_percentual: entrada.acao === "aprovar" ? entrada.percentual : null,
    p_situacao: entrada.acao === "aprovar" ? entrada.situacao : null,
  });
  conferirErro(error);
  return { id: entrada.id };
}
