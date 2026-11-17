import z from "zod";
export const consultaSchema = z.object({ obraId: z.uuid(), pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50) });
export const criarSchema = z.object({ obraId: z.uuid(), profileId: z.uuid("Escolha um empreiteiro.") });
export const excluirSchema = z.object({ id: z.uuid() });
