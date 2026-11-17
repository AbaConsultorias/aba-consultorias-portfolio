import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import z from "zod";
import { BadRequestError, InternalServerError } from "@/app/api/HttpErrors";

const VALIDADE_MS = 30 * 60 * 1000;
const CONTEXTO = "portal-upload-v1";
const base = {
  versao: z.literal(1),
  usuarioId: z.uuid(),
  registroId: z.uuid(),
  path: z.string().max(512),
  tamanho: z.number().int().positive(),
  expiraEm: z.iso.datetime(),
};
const documentoSchema = z.strictObject({
  ...base,
  finalidade: z.literal("documento"),
  bucket: z.literal("documentos"),
  mime: z.literal("application/pdf"),
  tamanho: base.tamanho.max(104857600),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  metadados: z.strictObject({
    empreendimentoId: z.uuid(),
    projetoId: z.uuid().nullish(),
    categoriaId: z.uuid().nullish(),
    titulo: z.string().trim().min(2).max(160),
  }),
});
const fotoSchema = z.strictObject({
  ...base,
  finalidade: z.literal("atualizacao_foto"),
  bucket: z.literal("obras"),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  tamanho: base.tamanho.max(10485760),
  metadados: z.strictObject({ atualizacaoId: z.uuid(), ordem: z.number().int().min(0).max(2147483647) }),
});
const EXTENSOES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" } as const;
const relatoFotoSchema = fotoSchema.extend({
  finalidade: z.literal("relato_foto"),
  metadados: z.strictObject({ obraId: z.uuid(), relatoId: z.uuid(), ordem: z.number().int().min(0).max(9) }),
});
const fornecedorMetadados = {
  fornecedorId: z.uuid(),
  empreendimentoId: z.uuid().nullish(),
  titulo: z.string().trim().min(2).max(160),
};
const fornecedorContratoSchema = z.strictObject({
  ...base,
  finalidade: z.literal("fornecedor_contrato"),
  bucket: z.literal("fornecedores"),
  mime: z.literal("application/pdf"),
  tamanho: base.tamanho.max(20971520),
  metadados: z.strictObject(fornecedorMetadados),
});
const fornecedorDocumentoSchema = fornecedorContratoSchema.extend({
  finalidade: z.literal("fornecedor_documento"),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  metadados: z.strictObject({ ...fornecedorMetadados, tipo: z.enum(["nota_fiscal", "certidao", "comprovante", "proposta", "outro"]) }),
});

const comprovanteSchema = z.discriminatedUnion("finalidade", [documentoSchema, fotoSchema, relatoFotoSchema, fornecedorContratoSchema, fornecedorDocumentoSchema]).refine((valor) => {
  if (valor.finalidade === "documento") {
    return valor.path === `${valor.metadados.empreendimentoId}/${valor.registroId}.pdf`
      && (!valor.metadados.categoriaId || Boolean(valor.metadados.projetoId));
  }
  if (valor.finalidade === "relato_foto") {
    return valor.path === `relatos/${valor.metadados.obraId}/${valor.metadados.relatoId}/${valor.registroId}.${EXTENSOES[valor.mime]}`;
  }
  if (valor.finalidade === "fornecedor_contrato" || valor.finalidade === "fornecedor_documento") {
    const pasta = valor.finalidade === "fornecedor_contrato" ? "contratos" : "documentos";
    const extensao = valor.mime === "application/pdf" ? "pdf" : EXTENSOES[valor.mime];
    return valor.path === `${valor.metadados.fornecedorId}/${pasta}/${valor.registroId}.${extensao}`;
  }
  const segmentos = valor.path.split("/");
  return segmentos.length === 4 && segmentos[0] === "atualizacoes"
    && z.uuid().safeParse(segmentos[1]).success
    && segmentos[2] === valor.metadados.atualizacaoId
    && segmentos[3] === `${valor.registroId}.${EXTENSOES[valor.mime]}`;
});

export type ComprovanteUpload = z.infer<typeof comprovanteSchema>;
type EntradaLegada<T extends { finalidade: string }> = Omit<T, "versao" | "expiraEm" | "finalidade"> & { finalidade?: T["finalidade"] };
export type EntradaComprovante =
  | EntradaLegada<z.infer<typeof documentoSchema>>
  | EntradaLegada<z.infer<typeof fotoSchema>>
  | Omit<z.infer<typeof relatoFotoSchema>, "versao" | "expiraEm">
  | Omit<z.infer<typeof fornecedorContratoSchema>, "versao" | "expiraEm">
  | Omit<z.infer<typeof fornecedorDocumentoSchema>, "versao" | "expiraEm">;
export type RelogioUpload = { agora: () => number };

function assinatura(payload: string): Buffer {
  const chave = process.env.SUPABASE_SECRET_KEY;
  if (!chave) throw new InternalServerError(null);
  return createHmac("sha256", chave).update(`${CONTEXTO}.${payload}`).digest();
}

function invalido(): never {
  throw new BadRequestError("Comprovante de upload inválido ou expirado.");
}

// As chamadas e os tokens em voo da Etapa 4 ainda usam apenas o bucket.
function normalizarFinalidade(dados: unknown): unknown {
  if (typeof dados !== "object" || dados === null || !("bucket" in dados) || "finalidade" in dados) return dados;
  if (dados.bucket === "documentos") return { ...dados, finalidade: "documento" };
  if (dados.bucket === "obras") return { ...dados, finalidade: "atualizacao_foto" };
  return dados;
}

export function assinarComprovante(entrada: EntradaComprovante, relogio: RelogioUpload = { agora: Date.now }): string {
  const resultado = comprovanteSchema.safeParse(normalizarFinalidade({
    ...entrada, versao: 1, expiraEm: new Date(relogio.agora() + VALIDADE_MS).toISOString(),
  }));
  if (!resultado.success) invalido();
  const payload = Buffer.from(JSON.stringify(resultado.data)).toString("base64url");
  return `${payload}.${assinatura(payload).toString("base64url")}`;
}

export function validarComprovante(token: string, usuarioId: string, relogio: RelogioUpload = { agora: Date.now }): ComprovanteUpload {
  if (typeof token !== "string" || token.length > 4096) invalido();
  const partes = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!partes) invalido();
  const [, payload, mac] = partes;
  const recebido = Buffer.from(mac, "base64url");
  const esperado = assinatura(payload);
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)
    || recebido.toString("base64url") !== mac) invalido();
  let dados: unknown;
  try { dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { invalido(); }
  const resultado = comprovanteSchema.safeParse(normalizarFinalidade(dados));
  if (!resultado.success) invalido();
  const restante = Date.parse(resultado.data.expiraEm) - relogio.agora();
  if (resultado.data.usuarioId !== usuarioId || restante <= 0 || restante > VALIDADE_MS) invalido();
  return resultado.data;
}
