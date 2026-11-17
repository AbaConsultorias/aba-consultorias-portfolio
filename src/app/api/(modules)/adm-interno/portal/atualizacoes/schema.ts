import z from "zod";
const nome = z.string().trim().min(2).max(160);
const texto = z.string().trim().max(5000).nullable();
const uuid = z.uuid();
export const consultaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50), empreendimentoId: uuid.optional(), id: uuid.optional() });
export const criarSchema = z.object({ empreendimentoId: uuid, projetoId: uuid.nullable().optional(), etapaId: uuid.nullable().optional(), titulo: nome, texto, dataVisita: z.iso.date().nullable() }).refine(v => !v.etapaId || !!v.projetoId, { message: 'Escolha o projeto da etapa.', path: ['etapaId'] });
export const atualizarSchema = z.object({ id: uuid, titulo: nome.optional(), texto: texto.optional(), dataVisita: z.iso.date().nullable().optional(), projetoId: uuid.nullable().optional(), etapaId: uuid.nullable().optional(), publicado: z.boolean().optional() });
export const excluirSchema = z.object({ id: uuid });
