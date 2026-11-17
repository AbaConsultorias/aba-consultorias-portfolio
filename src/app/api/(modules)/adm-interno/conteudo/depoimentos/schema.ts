import z from "zod";
import { texto, opcional, publicacao } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    nome: texto(120), cidade: opcional(160), texto: texto(3000), origem: z.enum(["google", "cliente"]), nota: z.number().int().min(1).max(5).nullable(), quando: opcional(100), ...publicacao
});
export const criarSchema = camposSchema.refine(v => v.origem === "google" ? v.nota !== null : v.nota === null, { message: "Informe nota somente para avaliações Google.", path: ["nota"] });
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") }).refine(v => v.origem === "google" ? v.nota !== null : v.nota === null, { message: "Informe nota somente para avaliações Google.", path: ["nota"] });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
