import z from "zod";
import { opcional, publicacao, caminho } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    video_path: caminho("instagram", true), poster_path: caminho("instagram").nullable(), legenda: opcional(2000), ...publicacao
});
export const criarSchema = camposSchema;
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
