import z from "zod";
const uuid = z.uuid();
export const ordenarSchema = z.object({
  empreendimentoId: uuid,
  projetoPaiId: uuid.nullable(),
  ids: uuid.array().min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Há projetos repetidos na lista."),
}).strict();
