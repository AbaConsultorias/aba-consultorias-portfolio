import "server-only";
import { BadRequestError, ConflictError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { listarOpcoesFornecedores } from "@/lib/portal/comum/opcoes";
import { CAMPOS_ITEM, itemSchema } from "@/lib/portal/financeiro/campos";
import { obterFinanceiro } from "@/lib/portal/financeiro/consultas";
import { conferirErro, exigirRegistro } from "@/lib/portal/financeiro/erros";
import type { AtualizarInput, ConsultaInput, CriarInput } from "./schema";

export async function listar({ empreendimentoId }: ConsultaInput) {
  return obterFinanceiro(empreendimentoId);
}

async function conferirFornecedor(fornecedorId: string, atualId: string | null) {
  if (fornecedorId === atualId) return;
  const fornecedores = await listarOpcoesFornecedores();
  if (!fornecedores.some((fornecedor) => fornecedor.id === fornecedorId && fornecedor.ativo)) throw new BadRequestError({ fornecedorId: "Escolha um fornecedor ativo." });
}

export async function criar({ empreendimentoId, fornecedorId, descricao, valorContratadoCentavos, observacao }: CriarInput) {
  await conferirFornecedor(fornecedorId, null);
  const db = await createClient();
  const { data, error } = await db.from("itens_financeiros")
    .insert({
      empreendimento_id: empreendimentoId, fornecedor_id: fornecedorId, descricao,
      valor_contratado_centavos: valorContratadoCentavos, observacao,
    })
    .select(CAMPOS_ITEM).single();
  conferirErro(error);
  return { registro: itemSchema.parse(data as unknown) };
}

export async function atualizar({ id, fornecedorId, descricao, valorContratadoCentavos, observacao }: AtualizarInput) {
  const db = await createClient();
  const atual = await db.from("itens_financeiros").select("fornecedor_id").eq("id", id).maybeSingle();
  conferirErro(atual.error);
  await conferirFornecedor(fornecedorId, exigirRegistro(atual.data).fornecedor_id);
  const { data, error } = await db.from("itens_financeiros")
    .update({ fornecedor_id: fornecedorId, descricao, valor_contratado_centavos: valorContratadoCentavos, observacao })
    .eq("id", id).select(CAMPOS_ITEM).maybeSingle();
  conferirErro(error);
  return { registro: itemSchema.parse(exigirRegistro(data) as unknown) };
}

export async function excluir(id: string) {
  const db = await createClient();
  const { data, error } = await db.rpc("excluir_item_financeiro_portal", { p_item: id });
  if (error?.code === "23503") {
    throw new ConflictError("Este item tem parcelas com pagamento registrado e não pode ser excluído.");
  }
  conferirErro(error);
  exigirRegistro(data);
  return { id };
}
