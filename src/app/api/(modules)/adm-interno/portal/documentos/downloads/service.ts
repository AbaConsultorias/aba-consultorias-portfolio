import "server-only";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { falhaDeBanco, normalizarPagina } from "@/lib/portal/documentos/consultas";
import type { DownloadDocumento } from "@/lib/portal/documentos/tipos";
import type { Pagina } from "@/lib/portal/comum/tipos";
import type { ConsultaInput } from "./schema";

const linhaSchema = z.object({
  id: z.uuid(),
  profile_id: z.uuid().nullable(),
  ip_hash: z.string().nullable(),
  em: z.string(),
});

// Só admin lê downloads_log (RLS); a rota exige o papel antes de chegar aqui. O hash do IP sai truncado:
// serve para reconhecer repetição de origem, não para identificar a rede.
export async function listar(consulta: ConsultaInput): Promise<Pagina<DownloadDocumento>> {
  const { pagina, limite, inicio } = normalizarPagina(consulta);
  const sessao = await createClient();
  const { data, error } = await sessao.from("downloads_log").select("id,profile_id,ip_hash,em")
    .eq("arquivo_tipo", "documento").eq("arquivo_id", consulta.documentoId)
    .order("em", { ascending: false }).order("id").range(inicio, inicio + limite);
  if (error) falhaDeBanco(error);
  const resultado = linhaSchema.array().safeParse(data as unknown);
  if (!resultado.success) throw new InternalServerError(null);

  const linhas = resultado.data.slice(0, limite);
  const nomes = new Map<string, string | null>();
  for (const profileId of new Set(linhas.flatMap((linha) => (linha.profile_id ? [linha.profile_id] : [])))) {
    const nome = await sessao.rpc("nome_pessoa", { p_profile: profileId });
    nomes.set(profileId, nome.error || typeof nome.data !== "string" ? null : nome.data);
  }

  return {
    registros: linhas.map((linha) => ({
      id: linha.id,
      profileId: linha.profile_id,
      nome: linha.profile_id ? nomes.get(linha.profile_id) ?? null : null,
      em: linha.em,
      origem: linha.ip_hash ? linha.ip_hash.slice(0, 8) : null,
    })),
    proximaPagina: resultado.data.length > limite ? pagina + 1 : null,
  };
}
