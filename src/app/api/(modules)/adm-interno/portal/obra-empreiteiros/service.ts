import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { NotFoundError } from "@/app/api/HttpErrors";
import { conferirErro } from "@/lib/portal/obras/erros";
import { listarEmpreiteirosDaObra } from "@/lib/portal/obras/consultas";
import { ler, paginacao, paginaDe } from "@/lib/portal/andamento/servidor";
import * as schemas from "./schema";

export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
  const { inicio, pagina, limite } = paginacao(entrada);
  return paginaDe((await listarEmpreiteirosDaObra(entrada.obraId)).slice(inicio, inicio + limite + 1), pagina, limite);
}
export async function criar(entrada: z.infer<typeof schemas.criarSchema>) {
  const sessao = await createClient();
  const { data, error } = await sessao.from("obra_empreiteiros").insert({ obra_id: entrada.obraId, profile_id: entrada.profileId }).select("id").single();
  conferirErro(error);
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
export async function excluir({ id }: z.infer<typeof schemas.excluirSchema>) {
  const sessao = await createClient();
  const { data, error } = await sessao.from("obra_empreiteiros").delete().eq("id", id).select("id").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Vínculo não encontrado.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
