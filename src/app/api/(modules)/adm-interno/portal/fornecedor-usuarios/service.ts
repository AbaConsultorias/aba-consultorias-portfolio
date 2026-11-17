import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { ler, paginacao, paginaDe } from "@/lib/portal/andamento/servidor";
import { conferirErro } from "@/lib/portal/fornecedor/erros";
import type * as schemas from "./schema";
const vinculoSchema = z.object({ id: z.uuid(), profileId: z.uuid(), profiles: z.object({ nome: z.string(), ativo: z.boolean() }) });
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
  const db = await createClient();
  const { inicio, pagina, limite } = paginacao(entrada);
  const { data, error } = await db.from("fornecedor_usuarios").select("id,profileId:profile_id,profiles!inner(nome,ativo)").eq("fornecedor_id", entrada.fornecedorId).order("id").range(inicio, inicio + limite);
  conferirErro(error);
  return paginaDe(ler(vinculoSchema.array(), data as unknown).map((v) => ({ id: v.id, profileId: v.profileId, nome: v.profiles.nome, ativo: v.profiles.ativo })), pagina, limite);
}
export async function criar(entrada: z.infer<typeof schemas.criarSchema>) {
  const db = await createClient();
  const { data, error } = await db.from("fornecedor_usuarios").insert({ fornecedor_id: entrada.fornecedorId, profile_id: entrada.profileId }).select("id").single();
  conferirErro(error);
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
export async function excluir({ id }: z.infer<typeof schemas.excluirSchema>) {
  const db = await createClient();
  const { error } = await db.from("fornecedor_usuarios").delete().eq("id", id);
  conferirErro(error);
  return { id };
}
