import z from "zod";
import { TIPOS_DOCUMENTO } from "./regras";

export const consultaPaginaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50) });
export const statusDocumentoSchema = z.enum(["pendente", "aprovado", "recusado"]);
export const fornecedorSchema = z.object({
  id: z.uuid(), razaoSocial: z.string(), nomeFantasia: z.string().nullable(), cnpj: z.string().nullable(),
  contatoNome: z.string().nullable(), telefone: z.string().nullable(), email: z.string().nullable(), observacao: z.string().nullable(), ativo: z.boolean(),
});
export const CAMPOS_FORNECEDOR = "id,razaoSocial:razao_social,nomeFantasia:nome_fantasia,cnpj,contatoNome:contato_nome,telefone,email,observacao,ativo";
const tamanhoSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
export const contratoSchema = z.object({ id: z.uuid(), fornecedorId: z.uuid(), empreendimentoId: z.uuid().nullable(), titulo: z.string(), tamanho: tamanhoSchema, criadoEm: z.string() });
export const documentoSchema = contratoSchema.extend({ tipo: z.enum(TIPOS_DOCUMENTO), status: statusDocumentoSchema, motivo: z.string().nullable(), revisadoEm: z.string().nullable() });
export const CAMPOS_CONTRATO = "id,fornecedorId:fornecedor_id,empreendimentoId:empreendimento_id,titulo,tamanho::text,criadoEm:criado_em";
export const CAMPOS_DOCUMENTO = `${CAMPOS_CONTRATO},tipo,status,motivo,revisadoEm:revisado_em`;
