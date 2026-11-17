import z from "zod";
import { dataCivilSchema, tipoEventoSchema } from "@/lib/portal/financeiro/campos";

export const consultaSchema = z.object({ empreendimentoId: z.uuid("Empreendimento inválido.") });

// A assinatura vem da data do contrato, não de um botão.
export const marcarSchema = z.object({
  empreendimentoId: z.uuid("Empreendimento inválido."),
  tipo: tipoEventoSchema.exclude(["assinatura"]),
  data: dataCivilSchema,
  projetoId: z.uuid("Projeto inválido.").nullable().default(null),
  itemId: z.uuid("Contrato inválido.").nullable().default(null),
  parcelaId: z.uuid("Parcela inválida.").nullable().default(null),
  substituir: z.boolean().default(false),
}).superRefine((evento, contexto) => {
  const { tipo, projetoId, itemId, parcelaId } = evento;
  const alvoCerto = tipo === "protocolo" || tipo === "aprovacao" ? projetoId !== null && itemId === null && parcelaId === null
    : tipo === "entrega" ? (projetoId === null) !== (itemId === null) && parcelaId === null
      : tipo === "outro" ? parcelaId !== null && projetoId === null && itemId === null
        : projetoId === null && itemId === null && parcelaId === null;
  if (!alvoCerto) contexto.addIssue({ code: "custom", path: ["tipo"], message: "O alvo informado não serve para este evento." });
});

export const desfazerSchema = z.object({ id: z.uuid("ID inválido.") });

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type MarcarInput = z.infer<typeof marcarSchema>;
