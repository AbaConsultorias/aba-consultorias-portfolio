import z from "zod";
import { opcional, https } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    whatsapp: z.string().regex(/^\d{10,15}$/, "Informe de 10 a 15 dígitos, incluindo DDI e DDD.").nullable().or(z.literal("")).transform(v => v || null), email: z.email("E-mail inválido.").max(254).nullable().or(z.literal("")).transform(v => v || null), telefone: opcional(40), endereco: opcional(500), mapa_url: https, instagram_url: https, instagram_usuario: z.string().max(30).regex(/^@?[a-zA-Z0-9._]*$/, "Usuário inválido.").nullable().transform(v => v || null), facebook_url: https, linkedin_url: https, sobre_titulo: opcional(250), sobre_texto: opcional(20000), google_avaliacoes_url: https, google_avaliar_url: https, google_nota: z.number().min(0).max(5).multipleOf(0.1).nullable(), google_total: z.number().int().min(0).max(100000000).nullable()
});
export const criarSchema = camposSchema;
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
