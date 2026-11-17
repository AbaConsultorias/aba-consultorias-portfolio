import z from "zod";
import { centavosSchema, dataCivilSchema } from "@/lib/portal/financeiro/campos";

const nome = z.string().trim().max(120, "Use até 120 caracteres.").transform((v) => v || null).nullable().default(null);
const observacao = z.string().trim().max(5000, "Use até 5000 caracteres.").transform((v) => v || null).nullable();

export const consultaSchema = z.object({
  itemId: z.uuid("Item inválido."),
  pagina: z.coerce.number().int().min(0).max(100000).default(0),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});
export const criarSchema = z.object({
  itemId: z.uuid("Item inválido."),
  nome,
  vencimento: dataCivilSchema,
  valorPrevistoCentavos: centavosSchema,
  observacao,
});
// Valores absolutos: repetir a requisição não soma o pagamento duas vezes.
// `corrigir` é a confirmação explícita para reduzir ou desfazer um pagamento já registrado.
export const atualizarSchema = z.object({
  id: z.uuid("ID inválido."),
  nome,
  // Nulo só vale para parcela por evento, que não muda de vencimento por aqui (o banco o calcula).
  vencimento: dataCivilSchema.nullable(),
  valorPrevistoCentavos: centavosSchema,
  valorPagoCentavos: centavosSchema,
  dataPagamento: dataCivilSchema.nullable(),
  observacao,
  corrigir: z.boolean().default(false),
});
export const excluirSchema = z.object({ id: z.uuid("ID inválido.") });

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
