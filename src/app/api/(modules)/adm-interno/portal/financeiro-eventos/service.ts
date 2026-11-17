import "server-only";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { listarEventosFinanceiros } from "@/lib/portal/financeiro/consultas";
import { conferirErro } from "@/lib/portal/financeiro/erros";
import type { ConsultaInput, MarcarInput } from "./schema";

export async function listar({ empreendimentoId }: ConsultaInput) {
  return { registros: await listarEventosFinanceiros(empreendimentoId) };
}

export async function marcar({ empreendimentoId, tipo, data, projetoId, itemId, parcelaId, substituir }: MarcarInput) {
  const db = await createClient();
  const { data: id, error } = await db.rpc("marcar_evento_financeiro", {
    p_empreendimento: empreendimentoId,
    p_tipo: tipo,
    p_data: data,
    p_projeto: projetoId,
    p_item: itemId,
    p_parcela: parcelaId,
    p_substituir: substituir,
  });
  conferirErro(error);
  const marcado = z.uuid().safeParse(id);
  if (!marcado.success) throw new InternalServerError(null);
  return { id: marcado.data };
}

export async function desfazer(id: string) {
  const db = await createClient();
  const { error } = await db.rpc("desfazer_evento_financeiro", { p_evento: id });
  conferirErro(error);
  return { id };
}
