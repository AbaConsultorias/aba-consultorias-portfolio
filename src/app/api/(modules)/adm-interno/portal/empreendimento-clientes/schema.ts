import z from "zod";
const uuid = z.uuid();
export const consultaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50), empreendimentoId: uuid });
export const criarSchema = z.object({ empreendimentoId: uuid, profileId: uuid });
export const excluirSchema = z.object({ id: uuid });
