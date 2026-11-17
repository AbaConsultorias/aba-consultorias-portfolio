import z from "zod";
const nome = z.string().trim().min(2).max(160);
const texto = z.string().trim().max(5000).nullable();
const uuid = z.uuid();
const ordem = z.number().int().min(0).max(2147483647);
const item = z.object({ id: uuid.optional(), nome, ordem });

// Marca da etapa: o que ela significa para as etapas pelas pastas (null = nenhuma). O banco aceita no máximo uma etapa
// de cada marca por modelo e só mexe nos marcos quando a chave vem na lista, por isso ela é sempre obrigatória aqui.
export const MARCOS_DE_ETAPA = ["confeccao", "analise", "aprovado"] as const;
export type MarcoDeEtapa = (typeof MARCOS_DE_ETAPA)[number];
export const ROTULO_DO_MARCO: Record<MarcoDeEtapa, string> = { confeccao: "Em confecção", analise: "Em análise", aprovado: "Aprovado" };
const MENSAGEM_MARCO_REPETIDO = "Cada marca só pode ser usada em uma etapa do modelo.";

const etapa = item.extend({ marco: z.enum(MARCOS_DE_ETAPA).nullable() });
const etapas = etapa.array().max(100).superRefine((lista, ctx) => {
  const marcas = lista.flatMap((valor) => (valor.marco ? [valor.marco] : []));
  if (new Set(marcas).size !== marcas.length) ctx.addIssue({ code: "custom", message: MENSAGEM_MARCO_REPETIDO });
});
const categorias = item.array().max(100);
export const consultaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50), id: uuid.optional() });
export const criarSchema = z.object({ nome, descricao: texto, ativo: z.boolean(), etapas, categorias });
export const atualizarSchema = criarSchema.extend({ id: uuid });
export const excluirSchema = z.object({ id: uuid });
