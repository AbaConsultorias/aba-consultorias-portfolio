import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { ConflictError, NotFoundError } from "@/app/api/HttpErrors";
import { ler } from "@/lib/portal/andamento/servidor";
import { conferirErro } from "@/lib/portal/fornecedor/erros";
import { listarDocumentosAdmin } from "@/lib/portal/fornecedor/consultas";
import { excluirArquivo } from "@/lib/portal/fornecedor/exclusao";
import type * as schemas from "./schema";
export const listar = (entrada: z.infer<typeof schemas.consultaSchema>) => listarDocumentosAdmin(entrada, entrada);
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>) {
  const db = await createClient();
  const { data, error } = await db.from("fornecedor_documentos").update({ status: entrada.status, motivo: entrada.status === "recusado" ? entrada.motivo : null }).eq("id", entrada.id).eq("status", "pendente").select("id").maybeSingle();
  conferirErro(error);
  if (data) return ler(z.object({ id: z.uuid() }), data as unknown);
  const atual = await db.from("fornecedor_documentos").select("id").eq("id", entrada.id).maybeSingle();
  conferirErro(atual.error);
  if (!atual.data) throw new NotFoundError("Documento indisponível.");
  throw new ConflictError("Este documento já foi revisado.");
}
export const excluir = ({ id }: z.infer<typeof schemas.excluirSchema>) => excluirArquivo("fornecedor_documentos", id);
