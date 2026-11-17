import z from "zod";
const nome = z.string().trim().min(2).max(160);
const texto = z.string().trim().max(5000).nullable();
const uuid = z.uuid();
const campos = {
  nome,
  cidade: z.string().trim().max(160).nullable().optional(),
  descricao: texto.optional(),
  situacao: z.enum(['ativo', 'concluido', 'arquivado']),
  loteamentoId: uuid.nullable().optional(),
};
// Vazio vira nulo (sem pasta no servidor). [0-9] e não \d, como o CHECK do banco.
const codigoPasta = z.union([
  z.null(),
  z.string().trim().transform((valor) => (valor === "" ? null : valor)).pipe(z.string().regex(/^[0-9]{6}$/, "O código da pasta tem 6 dígitos.").nullable()),
]).optional();
export const consultaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50), id: uuid.optional() });
export const criarSchema = z.object({ ...campos, situacao: campos.situacao.default('ativo') });
// Sem default aqui: um PATCH que não cita a situação não pode reativar um empreendimento arquivado.
// codigoPasta e liberacaoAutomatica só se alteram em empreendimento existente; ausentes, não mudam.
export const atualizarSchema = z.object(campos).partial().extend({ id: uuid, codigoPasta, liberacaoAutomatica: z.boolean().optional() });
export const excluirSchema = z.object({ id: uuid });
