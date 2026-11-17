import z from "zod";
export const consultaSchema = z.object({ status: z.enum(["pendente", "aprovado", "devolvido"]).default("pendente"), obraId: z.uuid().optional(), pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50) });
export const atualizarSchema = z.discriminatedUnion("acao", [
  z.object({ id: z.uuid(), acao: z.literal("aprovar"), percentual: z.number().int().min(0).max(100), situacao: z.enum(["planejada", "em_andamento", "concluida"]) }),
  z.object({ id: z.uuid(), acao: z.literal("devolver"), motivo: z.string("Explique o motivo da devolução (mínimo de 3 caracteres).").trim().min(3, "Explique o motivo da devolução (mínimo de 3 caracteres).").max(500) }),
]);
