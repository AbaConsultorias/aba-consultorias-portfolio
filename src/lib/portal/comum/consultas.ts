import "server-only";
import { cache } from "react";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import type { EmpreendimentoResumo, UUID } from "./tipos";

const empreendimentoSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  cidade: z.string().nullable(),
  situacao: z.enum(["ativo", "concluido", "arquivado"]),
});
const CAMPOS = "id,nome,cidade,situacao";

export const listarEmpreendimentos = cache(async (): Promise<EmpreendimentoResumo[]> => {
  const sessao = await createClient();
  const registros: EmpreendimentoResumo[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await sessao.from("empreendimentos").select(CAMPOS)
      .order("nome").order("id").range(inicio, inicio + 99);
    if (error) {
      console.error("[portal] consulta:", error.code);
      throw new InternalServerError(null);
    }
    const resultado = empreendimentoSchema.array().safeParse(data as unknown);
    if (!resultado.success) throw new InternalServerError(null);
    registros.push(...resultado.data);
    if (resultado.data.length < 100) return registros;
  }
});

export const obterEmpreendimento = cache(async (id: UUID): Promise<EmpreendimentoResumo | null> => {
  if (!z.uuid().safeParse(id).success) return null;
  const sessao = await createClient();
  const { data, error } = await sessao.from("empreendimentos").select(CAMPOS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[portal] consulta:", error.code);
    throw new InternalServerError(null);
  }
  if (data === null) return null;
  const resultado = empreendimentoSchema.safeParse(data as unknown);
  if (!resultado.success) throw new InternalServerError(null);
  return resultado.data;
});
