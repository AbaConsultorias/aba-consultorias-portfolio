import z from "zod";
import { centavosSchema } from "@/lib/portal/financeiro/campos";

const texto = (max: number) => z.string().trim().min(2, "Informe ao menos 2 caracteres.").max(max, `Use até ${max} caracteres.`);
const observacao = z.string().trim().max(5000, "Use até 5000 caracteres.").transform((v) => v || null).nullable();
// O contrato da ABA nasce só por /contratos; este módulo cuida dos itens de fornecedor.
const fornecedorId = z.uuid("Escolha um fornecedor.");

export const consultaSchema = z.object({ empreendimentoId: z.uuid("Empreendimento inválido.") });
export const criarSchema = z.object({
  empreendimentoId: z.uuid("Empreendimento inválido."),
  fornecedorId,
  descricao: texto(160),
  valorContratadoCentavos: centavosSchema,
  observacao,
});
export const atualizarSchema = z.object({
  id: z.uuid("ID inválido."),
  fornecedorId,
  descricao: texto(160),
  valorContratadoCentavos: centavosSchema,
  observacao,
});
export const excluirSchema = z.object({ id: z.uuid("ID inválido.") });

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
