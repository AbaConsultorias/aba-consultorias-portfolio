import z from "zod";
import { texto, opcional, publicacao, caminho } from "@/components/admin/conteudo/validacao";
import { identificadorSchema } from "@/components/admin/conteudo/validacao";
export const camposSchema = z.object({
    sobrancelha: texto(160), titulo: texto(250), titulo_destaque: opcional(250), texto: texto(2000), mensagem_whatsapp: opcional(1000), botao_rotulo: opcional(100), botao_href: opcional(500).refine(v => !v || /^(\/(?!\/)[^\s\\]*|#[a-zA-Z0-9_-]+)$/.test(v) && !/[\u0000-\u001f]/.test(v), "Use um caminho relativo ou âncora."), imagem_path: caminho("hero"), imagem_posicao: z.enum(["center", "left center", "right center", "62% center", "top center", "bottom center"]), legenda: opcional(500), ...publicacao
});
export const criarSchema = camposSchema;
export const atualizarSchema = camposSchema.extend({ id: z.uuid("ID inválido.") });
export const excluirSchema = identificadorSchema;
export const consultaSchema = z.object({});
export type CriarInput = z.infer<typeof criarSchema>;
export type AtualizarInput = z.infer<typeof atualizarSchema>;
