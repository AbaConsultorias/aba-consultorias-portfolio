import z from "zod";
import { normalizarCnpj } from "@/lib/portal/fornecedor/regras";
import { consultaPaginaSchema } from "@/lib/portal/fornecedor/campos";

export const consultaSchema = consultaPaginaSchema.extend({ modo: z.enum(["seletor", "completo"]).default("seletor") });
const texto = (max: number) => z.string().trim().max(max).nullable().optional().transform((valor) => valor || null);
export const criarSchema = z.object({
  razaoSocial: z.string().trim().min(2, "Informe a razão social.").max(160), nomeFantasia: texto(160),
  cnpj: texto(30).refine((valor) => valor === null || normalizarCnpj(valor) !== null, "Informe um CNPJ válido.").transform((valor) => valor ? normalizarCnpj(valor) : null),
  contatoNome: texto(160), telefone: texto(30), email: texto(254).refine((valor) => valor === null || z.email().safeParse(valor).success, "Informe um e-mail válido."),
  observacao: texto(5000), ativo: z.boolean().default(true),
});
export const atualizarSchema = criarSchema.extend({ id: z.uuid() });
export const excluirSchema = z.object({ id: z.uuid() });

export type ConsultaInput = z.input<typeof consultaSchema>;
export type FornecedorSeletor = { id: string; nome: string; ativo: boolean };
