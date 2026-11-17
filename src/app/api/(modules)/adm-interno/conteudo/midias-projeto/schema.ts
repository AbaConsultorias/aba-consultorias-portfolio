import z from "zod";
import { opcional, uuid, ordem, caminhoProjeto } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    portfolio_projeto_id: uuid, tipo: z.enum(["foto", "video"]), storage_path: caminhoProjeto, legenda: opcional(500), ordem
});
export const criarSchema = camposSchema.refine(v => v.storage_path.startsWith(`portfolio/${v.portfolio_projeto_id}/`) && (v.tipo === "video" ? v.storage_path.endsWith(".mp4") : !v.storage_path.endsWith(".mp4")), { message: "Arquivo incompatível com o projeto ou tipo.", path: ["storage_path"] });
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") }).refine(v => v.storage_path.startsWith(`portfolio/${v.portfolio_projeto_id}/`) && (v.tipo === "video" ? v.storage_path.endsWith(".mp4") : !v.storage_path.endsWith(".mp4")), { message: "Arquivo incompatível com o projeto ou tipo.", path: ["storage_path"] });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({ portfolio_projeto_id: z.uuid("ID inválido.") });
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
