import z from "zod";
const nome = z.string().trim().min(2).max(160);
const uuid = z.uuid();
const ordem = z.number().int().min(0).max(2147483647);
const item = z.object({ id: uuid.optional(), nome, ordem });
const etapas = item.extend({ concluidaEm: z.iso.date().nullable() }).array().max(100);
const categorias = item.array().max(100);
export const consultaSchema = z.object({ id: uuid });
export const atualizarSchema = z.object({ id: uuid, etapaAtualId: uuid.nullable(), etapas, categorias });
