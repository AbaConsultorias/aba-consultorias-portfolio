import z from "zod";
import { GRUPOS_DE_DOCUMENTO, validarPrefixoDeRegra, validarRotulo } from "@/lib/conector/sugestoes";

const uuid = z.uuid();

// Mesma validação da tela e do conector (src/lib/conector): o CHECK do banco é só a segunda barreira.
const caminhoPrefixo = z.string().max(1000).superRefine((valor, ctx) => {
  const resultado = validarPrefixoDeRegra(valor);
  if (!resultado.valido) ctx.addIssue({ code: "custom", message: resultado.motivo });
}).transform((valor) => valor.trim().normalize("NFC"));

// rotulo é o nome do cartão em "Outros projetos": obrigatório com grupo "arquivo" e proibido nos demais destinos.
const destino = {
  projetoId: uuid.nullable().optional(),
  categoriaId: uuid.nullable().optional(),
  grupo: z.enum(GRUPOS_DE_DOCUMENTO).nullable().optional(),
  rotulo: z.string().max(1000).nullable().optional().transform((valor) => (valor == null ? valor : valor.trim().normalize("NFC"))),
};

// "equipamentos" é a regra de SIMOS e Laudos: a pasta tem uma subpasta por equipamento e o destino é só o projeto.
// "protocolos" (pasta PROJETOS) e "devolutivas" (pasta LAN) marcam a etapa do projeto pelos arquivos que chegam.
export const TIPOS_DE_REGRA = ["comum", "equipamentos", "protocolos", "devolutivas"] as const;
export type TipoDeRegra = (typeof TIPOS_DE_REGRA)[number];
export const TIPOS_QUE_MARCAM_ETAPA: readonly TipoDeRegra[] = ["protocolos", "devolutivas"];
const tipo = z.enum(TIPOS_DE_REGRA);

type Destino = { projetoId?: string | null; categoriaId?: string | null; grupo?: string | null; rotulo?: string | null };
const MENSAGEM_DESTINO = "Escolha um projeto (com categoria opcional) ou um grupo, nunca os dois.";
const MENSAGEM_DESTINO_EQUIPAMENTOS = "SIMOS e Laudos pede só o projeto, sem categoria nem grupo.";
const MENSAGEM_DESTINO_ETAPA = "Protocolos e devolutivas pedem um projeto (com categoria opcional), sem grupo.";
const MENSAGEM_SO_OCULTA = "Protocolos e devolutivas ficam ocultos: não têm liberação automática.";
const MENSAGEM_ARQUIVO_OCULTO = "Os PDFs de Outros projetos ficam ocultos até a equipe liberar: não têm liberação automática.";
const MENSAGEM_ROTULO_SO_NO_ARQUIVO = "O rótulo vale só para o grupo Outros projetos (arquivo).";
const MENSAGEM_MARCA_APROVADO = "A marca Aprovado vale só para regra comum de um projeto.";

export const mensagemDoDestino = (tipoDaRegra: TipoDeRegra): string =>
  tipoDaRegra === "equipamentos" ? MENSAGEM_DESTINO_EQUIPAMENTOS : TIPOS_QUE_MARCAM_ETAPA.includes(tipoDaRegra) ? MENSAGEM_DESTINO_ETAPA : MENSAGEM_DESTINO;

// Espelha pasta_regras_destino_check, pasta_regras_equipamentos_destino_check e pasta_regras_etapas_destino_check:
// projeto (com categoria opcional) OU grupo, sem categoria; na regra de equipamentos, só o projeto; em protocolos e
// devolutivas, o projeto com categoria opcional e nunca o grupo. O rótulo acompanha o grupo "arquivo" (pasta_regras_rotulo_grupo_check).
export function destinoValido({ projetoId, categoriaId, grupo, rotulo }: Destino, tipoDaRegra: TipoDeRegra = "comum"): boolean {
  if ((grupo === "arquivo") !== (rotulo != null)) return false;
  if (tipoDaRegra === "equipamentos") return Boolean(projetoId) && !categoriaId && !grupo;
  if (TIPOS_QUE_MARCAM_ETAPA.includes(tipoDaRegra)) return Boolean(projetoId) && !grupo;
  if (projetoId) return !grupo;
  return !categoriaId && Boolean(grupo);
}

// Mensagem própria do rótulo, para a pessoa saber o que corrigir (destinoValido só diz que o destino está errado).
function problemasDoRotulo({ grupo, rotulo }: Destino): string[] {
  if (grupo === "arquivo") {
    const resultado = validarRotulo(rotulo ?? "");
    return resultado.valido ? [] : [resultado.motivo];
  }
  return rotulo != null ? [MENSAGEM_ROTULO_SO_NO_ARQUIVO] : [];
}

export const consultaSchema = z.object({ empreendimentoId: uuid });

// marcaAprovado ausente = o banco decide (pasta com APROVAD no caminho, em projeto com etapa Aprovado, já nasce marcada).
export const criarSchema = z.object({
  empreendimentoId: uuid,
  caminhoPrefixo,
  tipo: tipo.default("comum"),
  ...destino,
  marcaAprovado: z.boolean().optional(),
  liberarAutomatico: z.boolean().default(false),
  ativa: z.boolean().default(true),
}).superRefine((valor, ctx) => {
  if (!destinoValido(valor, valor.tipo)) {
    ctx.addIssue({ code: "custom", message: mensagemDoDestino(valor.tipo), path: ["projetoId"] });
  }
  for (const motivo of problemasDoRotulo(valor)) ctx.addIssue({ code: "custom", message: motivo, path: ["rotulo"] });
  if (valor.marcaAprovado === true && (valor.tipo !== "comum" || !valor.projetoId)) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_MARCA_APROVADO, path: ["marcaAprovado"] });
  }
  if (valor.liberarAutomatico && TIPOS_QUE_MARCAM_ETAPA.includes(valor.tipo)) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_SO_OCULTA, path: ["liberarAutomatico"] });
  }
  if (valor.liberarAutomatico && valor.grupo === "arquivo") {
    ctx.addIssue({ code: "custom", message: MENSAGEM_ARQUIVO_OCULTO, path: ["liberarAutomatico"] });
  }
});

// O destino só muda se algum dos quatro campos vier no corpo; aí os quatro são regravados (os ausentes viram nulo).
// Mudar o tipo exige mandar o destino junto; o serviço confere o destino contra o tipo que a regra terá.
export const atualizarSchema = z.object({
  id: uuid,
  caminhoPrefixo: caminhoPrefixo.optional(),
  tipo: tipo.optional(),
  ...destino,
  marcaAprovado: z.boolean().optional(),
  liberarAutomatico: z.boolean().optional(),
  ativa: z.boolean().optional(),
}).superRefine((valor, ctx) => {
  const mudaDestino = valor.projetoId !== undefined || valor.categoriaId !== undefined || valor.grupo !== undefined || valor.rotulo !== undefined;
  if (valor.tipo !== undefined && !mudaDestino) ctx.addIssue({ code: "custom", message: "Informe o destino junto com o tipo.", path: ["tipo"] });
  if (mudaDestino && !destinoValido(valor, valor.tipo ?? "comum")) {
    ctx.addIssue({ code: "custom", message: mensagemDoDestino(valor.tipo ?? "comum"), path: ["projetoId"] });
  }
  if (mudaDestino) {
    for (const motivo of problemasDoRotulo(valor)) ctx.addIssue({ code: "custom", message: motivo, path: ["rotulo"] });
  }
  if (valor.liberarAutomatico && valor.grupo === "arquivo") {
    ctx.addIssue({ code: "custom", message: MENSAGEM_ARQUIVO_OCULTO, path: ["liberarAutomatico"] });
  }
  if (valor.marcaAprovado === true && valor.tipo !== undefined && valor.tipo !== "comum") {
    ctx.addIssue({ code: "custom", message: MENSAGEM_MARCA_APROVADO, path: ["marcaAprovado"] });
  }
  if (valor.liberarAutomatico && valor.tipo !== undefined && TIPOS_QUE_MARCAM_ETAPA.includes(valor.tipo)) {
    ctx.addIssue({ code: "custom", message: MENSAGEM_SO_OCULTA, path: ["liberarAutomatico"] });
  }
  if (!mudaDestino && valor.tipo === undefined && valor.caminhoPrefixo === undefined && valor.marcaAprovado === undefined
    && valor.liberarAutomatico === undefined && valor.ativa === undefined) {
    ctx.addIssue({ code: "custom", message: "Informe o que alterar." });
  }
});

export const excluirSchema = z.object({ id: uuid });

export type ConsultaInput = z.infer<typeof consultaSchema>;
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
export type ExcluirInput = z.infer<typeof excluirSchema>;
