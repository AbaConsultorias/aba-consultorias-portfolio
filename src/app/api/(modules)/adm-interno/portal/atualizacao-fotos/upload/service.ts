import "server-only";
import { randomUUID } from "node:crypto";
import z from "zod";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assinarComprovante, validarComprovante, type ComprovanteUpload } from "@/lib/portal/comum/upload";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";
import { EXTENSOES_FOTO, FotoInvalida, lerFotoLimitada, validarBytesFoto } from "@/lib/portal/andamento/fotos";
import type { assinarSchema, confirmarSchema } from "./schema";

type ComprovanteFoto = Extract<ComprovanteUpload, { finalidade: "atualizacao_foto" }>;
const registroSchema = z.object({ id: z.uuid(), atualizacao_id: z.uuid(), storage_path: z.string(), mime: z.string(), tamanho: z.number().int(), ordem: z.number().int() });
type Registro = z.infer<typeof registroSchema>;
export type DependenciasFoto = {
  sessao: typeof createClient;
  assinar: (path: string) => Promise<{ path: string; signedUrl: string; token: string }>;
  lerObjeto: (path: string) => Promise<{ mime: string; stream: ReadableStream<Uint8Array> }>;
  apagar: (path: string) => Promise<void>;
  // Só a auditoria lembra de uma foto já excluída; ela não é legível pela sessão da equipe.
  registroExcluido: (id: string) => Promise<boolean>;
};
const OBJETO_AUSENTE = "O arquivo não chegou ao armazenamento. Envie novamente.";
const erroStorageSchema = z.object({ status: z.number().optional(), statusCode: z.union([z.string(), z.number()]).optional() });

function objetoAusente(error: unknown): boolean {
  if (!error) return false;
  const campos = erroStorageSchema.safeParse(error);
  return campos.success && (campos.data.status === 404 || String(campos.data.statusCode) === "404");
}
const dependenciasPadrao: DependenciasFoto = {
  sessao: createClient,
  async assinar(path) {
    const { data, error } = await createAdminClient().storage.from("obras").createSignedUploadUrl(path, { upsert: false });
    conferirErro(error);
    if (!data) throw new InternalServerError(null);
    return data;
  },
  async lerObjeto(path) {
    const { data, error } = await createAdminClient().storage.from("obras").createSignedUrl(path, 60);
    if (objetoAusente(error)) throw new BadRequestError(OBJETO_AUSENTE);
    conferirErro(error);
    if (!data) throw new InternalServerError(null);
    const resposta = await fetch(data.signedUrl, { cache: "no-store", redirect: "error" });
    if (resposta.status === 404) throw new BadRequestError(OBJETO_AUSENTE);
    if (!resposta.ok || !resposta.body) throw new InternalServerError("Não foi possível conferir o envio. Tente confirmar novamente.");
    return { mime: (resposta.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), stream: resposta.body };
  },
  async apagar(path) { const { error } = await createAdminClient().storage.from("obras").remove([path]); conferirErro(error); },
  async registroExcluido(id) {
    const { data, error } = await createAdminClient().from("auditoria").select("registro_id")
      .eq("tabela", "atualizacao_fotos").eq("registro_id", id).eq("acao", "DELETE").limit(1);
    conferirErro(error);
    return (data ?? []).length > 0;
  },
};

async function pai(sessao: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await sessao.from("atualizacoes").select("id,empreendimento_id").eq("id", id).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError();
  return ler(z.object({ id: z.uuid(), empreendimento_id: z.uuid() }), data as unknown);
}

export async function assinar(entrada: z.infer<typeof assinarSchema>, usuarioId: string, deps = dependenciasPadrao) {
  const sessao = await deps.sessao();
  const atualizacao = await pai(sessao, entrada.atualizacaoId);
  const registroId = randomUUID();
  const path = `atualizacoes/${atualizacao.empreendimento_id}/${atualizacao.id}/${registroId}.${EXTENSOES_FOTO[entrada.mime]}`;
  const comprovante = assinarComprovante({ usuarioId, registroId, bucket: "obras", path, mime: entrada.mime, tamanho: entrada.tamanho, metadados: { atualizacaoId: entrada.atualizacaoId, ordem: entrada.ordem } });
  const envio = await deps.assinar(path);
  return { ...envio, path, comprovante };
}

function compativel(foto: Registro, comprovante: ComprovanteFoto): boolean {
  return foto.id === comprovante.registroId && foto.storage_path === comprovante.path && foto.atualizacao_id === comprovante.metadados.atualizacaoId && foto.mime === comprovante.mime && foto.tamanho === comprovante.tamanho;
}

export async function confirmar(entrada: z.infer<typeof confirmarSchema>, usuarioId: string, deps = dependenciasPadrao) {
  const comprovante = validarComprovante(entrada.comprovante, usuarioId);
  if (comprovante.finalidade !== "atualizacao_foto") throw new BadRequestError("Comprovante incompatível.");
  const sessao = await deps.sessao();
  const atualizacao = await pai(sessao, comprovante.metadados.atualizacaoId);
  if (comprovante.path !== `atualizacoes/${atualizacao.empreendimento_id}/${atualizacao.id}/${comprovante.registroId}.${EXTENSOES_FOTO[comprovante.mime]}`) throw new BadRequestError("Comprovante incompatível.");
  async function existente() {
    const { data, error } = await sessao.from("atualizacao_fotos").select("id,atualizacao_id,storage_path,mime,tamanho,ordem").or(`id.eq.${comprovante.registroId},storage_path.eq.${comprovante.path}`);
    conferirErro(error);
    return ler(registroSchema.array(), data as unknown);
  }
  const anteriores = await existente();
  if (anteriores.length) {
    if (anteriores.length === 1 && compativel(anteriores[0], comprovante)) return { id: comprovante.registroId };
    throw new ConflictError("Este envio já está associado a outro registro.");
  }
  // A URL de envio sobrevive à exclusão: sem isto, reenviar ao mesmo path ressuscitaria a foto apagada.
  if (await deps.registroExcluido(comprovante.registroId)) {
    await deps.apagar(comprovante.path);
    throw new BadRequestError("Este envio já foi usado por uma foto excluída. Inicie um novo envio.");
  }
  const objeto = await deps.lerObjeto(comprovante.path);
  try {
    const bytes = await lerFotoLimitada(objeto.stream, comprovante.tamanho);
    if (objeto.mime !== comprovante.mime || !validarBytesFoto(bytes, comprovante.mime)) throw new FotoInvalida("O conteúdo não corresponde ao formato informado.");
  } catch (error) {
    if (!(error instanceof FotoInvalida)) throw error;
    if (!(await existente()).length) await deps.apagar(comprovante.path);
    throw new BadRequestError(error.message);
  }
  const { error } = await sessao.from("atualizacao_fotos").insert({ id: comprovante.registroId, atualizacao_id: atualizacao.id, storage_path: comprovante.path, mime: comprovante.mime, tamanho: comprovante.tamanho, ordem: comprovante.metadados.ordem });
  if (error?.code === "23505") {
    const registros = await existente();
    if (registros.length === 1 && compativel(registros[0], comprovante)) return { id: comprovante.registroId };
  }
  conferirErro(error);
  return { id: comprovante.registroId };
}
