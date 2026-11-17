import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { NotFoundError } from "@/app/api/HttpErrors";
import { ler, paginaDe, paginacao } from "@/lib/portal/andamento/servidor";
import { conferirErro } from "@/lib/portal/fornecedor/erros";
import { listarContratosAdmin } from "@/lib/portal/fornecedor/consultas";
import { excluirArquivo } from "@/lib/portal/fornecedor/exclusao";
import type * as schemas from "./schema";
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
  const { inicio, pagina, limite } = paginacao(entrada);
  const registros = await listarContratosAdmin(entrada.fornecedorId);
  return paginaDe(registros.slice(inicio, inicio + limite + 1), pagina, limite);
}
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>) {
  const db = await createClient();
  const { data, error } = await db.from("fornecedor_contratos").update({ titulo: entrada.titulo, empreendimento_id: entrada.empreendimentoId }).eq("id", entrada.id).select("id").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Contrato indisponível.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
export const excluir = ({ id }: z.infer<typeof schemas.excluirSchema>) => excluirArquivo("fornecedor_contratos", id);
