import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";

const opcaoSchema = z.object({ id: z.uuid(), nome: z.string() });
const empreendimentoSchema = opcaoSchema.extend({ cidade: z.string().nullable() });
const fornecedorSchema = opcaoSchema.extend({ ativo: z.boolean() });

// Listas mínimas para seletores: a tela não precisa abrir a tabela do outro módulo.
// Quem não tem nenhuma permissão aceita pela função recebe lista vazia.
async function listar<T>(funcao: string, schema: z.ZodType<T>): Promise<T[]> {
  const sessao = await createClient();
  const { data, error } = await sessao.rpc(funcao);
  conferirErro(error);
  return ler(schema.array(), data as unknown);
}

export const listarOpcoesEmpreendimentos = () => listar("opcoes_empreendimentos", empreendimentoSchema);
export const listarOpcoesFornecedores = () => listar("opcoes_fornecedores", fornecedorSchema);
export const listarOpcoesLoteamentos = () => listar("opcoes_loteamentos", opcaoSchema);
