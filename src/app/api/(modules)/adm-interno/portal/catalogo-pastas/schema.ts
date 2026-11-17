import z from "zod";
import { normalizarTermo } from "@/lib/conector/montagem";

// Mesmo formato dos CHECKs do banco (catalogo_termos_validos): palavra sem acento em maiúsculas; "!" exclui, "*" no fim é prefixo.
const TERMO = /^!?[A-Z0-9]{1,30}\*?(\|[A-Z0-9]{1,30}\*?){0,5}$/;
const termo = z.string().max(60).transform(normalizarTermo).pipe(z.string().regex(TERMO, "Use só letras sem acento e números, com “!” na frente para excluir, “*” no fim para prefixo e “|” entre alternativas (ex.: RESERVATORIO|REL)."));
const termos = (minimo: number) => z.array(termo).min(minimo).max(16);
const nivel = z.array(termo).min(1).max(6);
const caminho = z.array(nivel).min(1).max(4);
const texto = (maximo: number) => z.string().trim().min(1).max(maximo);

export const atualizarCatalogoSchema = z.strictObject({
  id: z.uuid(),
  termos: termos(1).optional(),
  termosExcluir: termos(0).optional(),
  subpastas: z.array(caminho).max(6).optional(),
  nomeProjeto: texto(160).nullable().optional(),
  categoria: texto(120).nullable().optional(),
  modeloId: z.uuid().nullable().optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).max(1000).optional(),
}).superRefine((valor, ctx) => {
  const mudaAlgo = Object.entries(valor).some(([campo, conteudo]) => campo !== "id" && conteudo !== undefined);
  if (!mudaAlgo) ctx.addIssue({ code: "custom", message: "Informe o que alterar." });
});

export type AtualizarCatalogoInput = z.infer<typeof atualizarCatalogoSchema>;
