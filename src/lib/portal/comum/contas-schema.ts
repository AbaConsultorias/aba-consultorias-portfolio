import z from "zod";
import { entrarSchema } from "@/app/api/(modules)/entrar/schema";

const nome = z.string().trim().min(2).max(160);
const uuid = z.uuid();
export const consultaContasSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1), limite: z.coerce.number().int().min(1).max(100).default(50) });
export const criarContaSchema = z.object({ nome, telefone: z.string().trim().max(30).nullable().optional(), identificador: entrarSchema.shape.identificador, senha: z.string().min(10).max(128).regex(/[a-zA-Z]/).regex(/[0-9]/) });
export const atualizarContaSchema = z.object({ id: uuid, nome, telefone: z.string().trim().max(30).nullable(), ativo: z.boolean() });

export const papelContaSchema = z.enum(["cliente", "empreiteiro", "fornecedor"]);
export type PapelConta = z.infer<typeof papelContaSchema>;
export type CriarContaInput = z.infer<typeof criarContaSchema>;
export type AtualizarContaInput = z.infer<typeof atualizarContaSchema>;
