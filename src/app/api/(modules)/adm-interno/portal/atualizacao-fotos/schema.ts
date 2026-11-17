import z from "zod";
const uuid = z.uuid();
const ordem = z.number().int().min(0).max(2147483647);
export const consultaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50), atualizacaoId: uuid });
export const atualizarSchema = z.object({ id: uuid, ordem });
export const excluirSchema = z.object({ id: uuid });
