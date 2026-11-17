import z from "zod";
const campos = {
  nome: z.string().trim().min(2, "Informe o nome da obra.").max(160),
  previstoInicio: z.iso.date("Data inválida.").nullable(),
  previstoFim: z.iso.date("Data inválida.").nullable(),
  situacao: z.enum(["planejada", "em_andamento", "concluida"]),
  percentual: z.number().int().min(0).max(100),
};
const periodoValido = (obra: { previstoInicio: string | null; previstoFim: string | null }) => !obra.previstoInicio || !obra.previstoFim || obra.previstoFim >= obra.previstoInicio;
const erroPeriodo = { message: "O fim previsto deve ser igual ou posterior ao início.", path: ["previstoFim"] };
export const consultaSchema = z.object({ empreendimentoId: z.uuid(), pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50) });
export const criarSchema = z.object({ empreendimentoId: z.uuid(), ...campos }).refine(periodoValido, erroPeriodo);
export const atualizarSchema = z.object({ id: z.uuid(), ...campos }).refine(periodoValido, erroPeriodo);
export const excluirSchema = z.object({ id: z.uuid() });
