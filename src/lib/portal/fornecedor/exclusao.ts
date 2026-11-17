import "server-only";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { ler } from "@/lib/portal/andamento/servidor";
import { armazenamentoFornecedor } from "./armazenamento";
import { conferirErro } from "./erros";

export async function excluirArquivo(tabela: "fornecedor_contratos" | "fornecedor_documentos", id: string, dependencias = { criarSessao: createClient, armazenamento: armazenamentoFornecedor }) {
  const db = await dependencias.criarSessao();
  const { data, error } = await db.from(tabela).select("id,fornecedor_id,storage_path").eq("id", id).maybeSingle();
  conferirErro(error);
  if (!data) return { id };
  const linha = ler(z.object({ id: z.uuid(), fornecedor_id: z.uuid(), storage_path: z.string() }), data as unknown);
  const pasta = tabela === "fornecedor_contratos" ? "contratos" : "documentos";
  if (!linha.storage_path.startsWith(`${linha.fornecedor_id}/${pasta}/`) || linha.storage_path.includes("..")) throw new InternalServerError(null);
  await dependencias.armazenamento.removerObjeto(linha.storage_path);
  const removido = await db.from(tabela).delete().eq("id", id);
  conferirErro(removido.error);
  return { id };
}
