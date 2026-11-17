import z from "zod";
import { texto, opcional, publicacao, slug, caminhoProjeto } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    titulo: texto(250), slug, cidade: opcional(160), categoria: z.enum(["loteamento", "residencial", "obra_copasa", "outro"]), descricao: opcional(20000), concluido_em: z.iso.date("Informe uma data válida.").nullable(), capa_path: caminhoProjeto.refine(v => !v.endsWith(".mp4"), "Envie uma imagem.").nullable(), ...publicacao
});
export const criarSchema = camposSchema;
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
