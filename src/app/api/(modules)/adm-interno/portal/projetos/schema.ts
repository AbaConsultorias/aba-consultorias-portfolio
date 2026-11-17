import z from "zod";
const nome = z.string().trim().min(2).max(160);
const uuid = z.uuid();
export const consultaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50), empreendimentoId: uuid.optional(), id: uuid.optional() });
export const criarSchema = z.object({ empreendimentoId: uuid, modeloId: uuid, nome, projetoPaiId: uuid.nullable().optional() });
export const atualizarSchema = z.object({ id: uuid, nome, projetoPaiId: uuid.nullable().optional() });
export const excluirSchema = z.object({ id: uuid });
