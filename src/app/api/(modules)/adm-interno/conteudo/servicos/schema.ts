import z from "zod";
import { texto, opcional, publicacao, slug, caminho } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    frente: z.enum(["loteadores", "casa"]), titulo: texto(250), slug, subtitulo: opcional(500), resumo: opcional(2000), conteudo: opcional(20000), itens: z.array(texto(500)).max(50), icone: opcional(100), foto_path: caminho("servicos").nullable(), mensagem_whatsapp: opcional(1000), ...publicacao
});
export const criarSchema = camposSchema.refine(v => v.frente !== "casa" || ["arquitetonico", "eletrico", "hidrossanitario"].includes(v.icone ?? ""), { message: "Selecione o desenho para sua casa.", path: ["icone"] });
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") }).refine(v => v.frente !== "casa" || ["arquitetonico", "eletrico", "hidrossanitario"].includes(v.icone ?? ""), { message: "Selecione o desenho para sua casa.", path: ["icone"] });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
