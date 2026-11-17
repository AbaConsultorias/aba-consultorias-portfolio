import z from "zod";
import { texto, https, publicacao, caminho } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    nome: texto(160), logo_path: caminho("parceiros"), site_url: https, ...publicacao
});
export const criarSchema = camposSchema;
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
