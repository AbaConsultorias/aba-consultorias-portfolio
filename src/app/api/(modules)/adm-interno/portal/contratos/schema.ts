import z from "zod";
import { dataCivilSchema, tipoEventoSchema } from "@/lib/portal/financeiro/campos";

const centavos = z.string().regex(/^\d{1,15}$/, "Informe um valor válido.");
const textoOpcional = (max: number) => z.string().trim().max(max, `Use até ${max} caracteres.`).transform((v) => v || null).nullable();

const parcelaSchema = z.object({
  id: z.uuid("Parcela inválida.").optional(),
  nome: z.string().trim().min(1, "Informe o nome da parcela.").max(120, "Use até 120 caracteres."),
  valorPrevistoCentavos: centavos,
  gatilho: z.enum(["data", "evento"]),
  vencimento: dataCivilSchema.nullable().default(null),
  eventoTipo: tipoEventoSchema.nullable().default(null),
  eventoProjetoId: z.uuid("Projeto inválido.").nullable().default(null),
  eventoDescricao: z.string().trim().min(1, "Descreva o evento.").max(120, "Use até 120 caracteres.").nullable().default(null),
  diasApos: z.number().int("Informe um número inteiro de dias.").min(0, "Os dias não podem ser negativos.").max(3650, "Use até 3650 dias.").default(0),
}).superRefine((parcela, contexto) => {
  const problema = (path: string, message: string) => contexto.addIssue({ code: "custom", path: [path], message });
  if (parcela.gatilho === "data") {
    if (parcela.vencimento === null) problema("vencimento", "Informe o vencimento da parcela.");
    if (parcela.eventoTipo !== null || parcela.eventoProjetoId !== null || parcela.eventoDescricao !== null || parcela.diasApos !== 0) {
      problema("gatilho", "Parcela com data fixa não leva evento nem dias.");
    }
    return;
  }
  if (parcela.vencimento !== null) problema("vencimento", "Parcela por evento não leva vencimento: ele é calculado pelo evento.");
  if (parcela.eventoTipo === null) return problema("eventoTipo", "Informe o evento da parcela.");
  const comProjeto = parcela.eventoTipo === "protocolo" || parcela.eventoTipo === "aprovacao" || parcela.eventoTipo === "entrega";
  if (parcela.eventoProjetoId !== null && !comProjeto) problema("eventoProjetoId", "Este evento não leva projeto.");
  if (parcela.eventoProjetoId === null && parcela.eventoTipo !== "entrega" && comProjeto) problema("eventoProjetoId", "Informe o projeto do evento.");
  if (parcela.eventoTipo === "outro" && parcela.eventoDescricao === null) problema("eventoDescricao", "Descreva o evento.");
  if (parcela.eventoTipo !== "outro" && parcela.eventoDescricao !== null) problema("eventoDescricao", "Só o evento \"outro\" leva descrição.");
});

const dadosDoContrato = z.object({
  empreendimentoId: z.uuid("Empreendimento inválido."),
  descricao: z.string().trim().min(1, "Informe a descrição do contrato.").max(200, "Use até 200 caracteres."),
  codigo: z.string().trim().toUpperCase().regex(/^[0-9]{6}[A-Z]{1,4}$/, "Informe o código no formato 260703C."),
  versao: z.number().int("A versão precisa ser um número inteiro.").min(1, "A versão começa em 1.").max(999999).nullable(),
  assinadoEm: dataCivilSchema.nullable(),
  documentoId: z.uuid("Documento inválido.").nullable(),
  valorContratadoCentavos: centavos,
  observacao: textoOpcional(5000),
  projetos: z.array(z.uuid("Projeto inválido.")).max(100, "Use até 100 projetos."),
  parcelas: z.array(parcelaSchema).max(60, "Use até 60 parcelas."),
});

function conferirProjetos(contrato: z.infer<typeof dadosDoContrato>, contexto: z.RefinementCtx) {
  if (new Set(contrato.projetos).size !== contrato.projetos.length) {
    contexto.addIssue({ code: "custom", path: ["projetos"], message: "Há projetos repetidos." });
  }
  contrato.parcelas.forEach((parcela, indice) => {
    if (parcela.eventoProjetoId !== null && !contrato.projetos.includes(parcela.eventoProjetoId)) {
      contexto.addIssue({ code: "custom", path: ["parcelas", indice, "eventoProjetoId"], message: "O projeto da parcela precisa estar entre os projetos do contrato." });
    }
  });
}

export const criarSchema = dadosDoContrato.superRefine(conferirProjetos);
export const atualizarSchema = dadosDoContrato.extend({
  id: z.uuid("ID inválido."),
  atualizadoEm: z.iso.datetime("Recarregue a página para editar este contrato."),
}).superRefine(conferirProjetos);

export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
