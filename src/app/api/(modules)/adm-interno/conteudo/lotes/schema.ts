import z from "zod";

export const STATUS_LOTE = ["disponivel", "vendido", "area_tecnica"] as const;

export const idSchema = z.object({ id: z.uuid("ID inválido.") });

const status = z.enum(STATUS_LOTE, "Status inválido.");

const identificador = (rotulo: string) =>
  z.string(`Informe ${rotulo}.`).trim().min(1, `Informe ${rotulo}.`).max(20, `${rotulo} muito longo.`);

const areaM2 = z
  .number("Área inválida.")
  .positive("A área deve ser maior que zero.")
  .max(99_999_999, "Área muito grande.")
  .nullable()
  .optional();

const svgId = z
  .string("Código do mapa inválido.")
  .trim()
  .max(100, "Código do mapa muito longo.")
  .regex(/^[A-Za-z0-9_.:-]*$/, "Use só letras, números, ponto, hífen e sublinhado.")
  .transform((valor) => (valor === "" ? null : valor))
  .nullable()
  .optional();

const observacao = z
  .string("Observação inválida.")
  .trim()
  .max(500, "Observação muito longa.")
  .transform((valor) => (valor === "" ? null : valor))
  .nullable()
  .optional();

const camposDoLote = {
  quadra: identificador("a quadra"),
  numero: identificador("o número"),
  areaM2,
  svgId,
  observacao,
  status,
};

export const criarLoteSchema = z.object({
  loteamentoId: z.uuid("ID inválido."),
  ...camposDoLote,
  status: status.default("disponivel"),
});
export type CriarLoteInput = z.infer<typeof criarLoteSchema>;

export const criarLotesEmMassaSchema = z
  .object({
    loteamentoId: z.uuid("ID inválido."),
    quadra: identificador("a quadra"),
    de: z.number("Número inicial inválido.").int("Número inicial inválido.").min(1, "O número inicial mínimo é 1."),
    ate: z.number("Número final inválido.").int("Número final inválido.").max(99_999, "Número final muito grande."),
    areaM2,
    status: status.default("disponivel"),
  })
  .refine((valor) => valor.ate >= valor.de, { message: "O número final deve ser maior ou igual ao inicial.", path: ["ate"] })
  .refine((valor) => valor.ate - valor.de < 500, { message: "Crie até 500 lotes por vez.", path: ["ate"] });
export type CriarLotesEmMassaInput = z.infer<typeof criarLotesEmMassaSchema>;

export const atualizarLoteSchema = z
  .object(camposDoLote)
  .partial()
  .refine((valor) => Object.keys(valor).length > 0, "Nada para atualizar.");
export type AtualizarLoteInput = z.infer<typeof atualizarLoteSchema>;
