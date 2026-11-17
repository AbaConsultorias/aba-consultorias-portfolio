import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { conferirErro } from "@/lib/portal/fornecedor/erros";
import { ConflictError, NotFoundError } from "@/app/api/HttpErrors";
import { ler } from "@/lib/portal/andamento/servidor";
import { criarSchema, atualizarSchema, excluirSchema } from "./schema";
import type { ConsultaInput, FornecedorSeletor } from "./schema";

const TAMANHO_PAGINA = 100;
const linhaSchema = z.object({
  id: z.uuid(),
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  ativo: z.boolean(),
});

export async function listar(_consulta: ConsultaInput): Promise<{ registros: FornecedorSeletor[] }> {
  void _consulta;
  const db = await createClient();
  const registros: FornecedorSeletor[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await db.from("fornecedores").select("id,razao_social,nome_fantasia,ativo")
      .order("razao_social").order("id").range(inicio, inicio + TAMANHO_PAGINA - 1);
    conferirErro(error);
    const linhas = linhaSchema.array().parse(data as unknown);
    registros.push(...linhas.map((linha) => ({ id: linha.id, nome: linha.nome_fantasia ?? linha.razao_social, ativo: linha.ativo })));
    if (linhas.length < TAMANHO_PAGINA) return { registros };
  }
}

function campos(entrada: z.infer<typeof criarSchema>) {
  return { razao_social: entrada.razaoSocial, nome_fantasia: entrada.nomeFantasia, cnpj: entrada.cnpj, contato_nome: entrada.contatoNome, telefone: entrada.telefone, email: entrada.email, observacao: entrada.observacao, ativo: entrada.ativo };
}

function conferirCadastro(error: { code?: string } | null) {
  if (error?.code === "23505") throw new ConflictError("CNPJ já cadastrado.");
  conferirErro(error);
}

export async function criar(entrada: z.infer<typeof criarSchema>) {
  const db = await createClient();
  const { data, error } = await db.from("fornecedores").insert(campos(entrada)).select("id").single();
  conferirCadastro(error);
  return ler(z.object({ id: z.uuid() }), data as unknown);
}

export async function atualizar(entrada: z.infer<typeof atualizarSchema>) {
  const db = await createClient();
  const { data, error } = await db.from("fornecedores").update(campos(entrada)).eq("id", entrada.id).select("id").maybeSingle();
  conferirCadastro(error);
  if (!data) throw new NotFoundError("Fornecedor indisponível.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}

export async function excluir({ id }: z.infer<typeof excluirSchema>) {
  const db = await createClient();
  for (const tabela of ["itens_financeiros", "fornecedor_contratos", "fornecedor_documentos", "fornecedor_usuarios"]) {
    const { count, error } = await db.from(tabela).select("id", { count: "exact", head: true }).eq("fornecedor_id", id);
    conferirErro(error);
    if (count) throw new ConflictError("Fornecedor em uso. Desative o cadastro para manter o histórico.");
  }
  const { error } = await db.from("fornecedores").delete().eq("id", id);
  conferirErro(error);
  return { id };
}
