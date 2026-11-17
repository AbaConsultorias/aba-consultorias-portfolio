import "server-only";
import { randomUUID } from "node:crypto";
import z from "zod";
import { BadRequestError, ConflictError, InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assinarComprovante, validarComprovante, type ComprovanteUpload, type RelogioUpload } from "@/lib/portal/comum/upload";
import { ler } from "@/lib/portal/andamento/servidor";
import type { AssinarInput as ContratoInput } from "@/app/api/(modules)/adm-interno/portal/fornecedor-contratos/upload/schema";
import type { AssinarInput as DocumentoInput } from "@/app/api/(modules)/portal/fornecedor/documentos/upload/schema";
import { armazenamentoFornecedor, type Armazenamento } from "./armazenamento";
import { ArquivoFornecedorInvalido, validarArquivoFornecedor } from "./bytes";
import { conferirErro } from "./erros";

type Finalidade = "fornecedor_contrato" | "fornecedor_documento";
type Comprovante = Extract<ComprovanteUpload, { finalidade: Finalidade }>;
export type DependenciasEnvio = {
  criarSessao: typeof createClient; armazenamento: Armazenamento; novoId: () => string; relogio: RelogioUpload;
  contratoExcluido: (id: string) => Promise<boolean>;
};
const padrao: DependenciasEnvio = {
  criarSessao: createClient, armazenamento: armazenamentoFornecedor, novoId: randomUUID, relogio: { agora: Date.now },
  async contratoExcluido(id) {
    // A sessão da equipe não lê auditoria; como na Etapa 4, o tombstone impede ressuscitar o arquivo.
    const { data, error } = await createAdminClient().from("auditoria").select("registro_id").eq("tabela", "fornecedor_contratos").eq("registro_id", id).eq("acao", "DELETE").limit(1);
    conferirErro(error);
    return ler(z.object({ registro_id: z.uuid() }).array(), data as unknown).length > 0;
  },
};

async function conferirPais(db: Awaited<ReturnType<typeof createClient>>, entrada: ContratoInput, finalidade: Finalidade) {
  const fornecedor = await db.from("fornecedores").select("id").eq("id", entrada.fornecedorId).maybeSingle();
  conferirErro(fornecedor.error);
  if (!fornecedor.data) throw new BadRequestError("Fornecedor indisponível.");
  if (!entrada.empreendimentoId) return;
  if (finalidade === "fornecedor_contrato") {
    // fornecedores.editar não lê a tabela de empreendimentos; a lista de opções só traz id e nome.
    const opcoes = await db.rpc("opcoes_empreendimentos");
    conferirErro(opcoes.error);
    if (!ler(z.object({ id: z.uuid() }).array(), opcoes.data as unknown).some((opcao) => opcao.id === entrada.empreendimentoId)) throw new BadRequestError("Empreendimento indisponível para este fornecedor.");
    return;
  }
  const item = await db.from("itens_financeiros").select("id").eq("fornecedor_id", entrada.fornecedorId).eq("empreendimento_id", entrada.empreendimentoId).limit(1).maybeSingle();
  conferirErro(item.error);
  if (!item.data) throw new BadRequestError("Empreendimento indisponível para este fornecedor.");
}

export async function assinarContrato(entrada: ContratoInput, usuarioId: string, deps: DependenciasEnvio = padrao) {
  const db = await deps.criarSessao();
  await conferirPais(db, entrada, "fornecedor_contrato");
  const registroId = deps.novoId();
  const path = `${entrada.fornecedorId}/contratos/${registroId}.pdf`;
  const comprovante = assinarComprovante({ finalidade: "fornecedor_contrato", bucket: "fornecedores", usuarioId, registroId, path, mime: "application/pdf", tamanho: entrada.tamanho, metadados: { fornecedorId: entrada.fornecedorId, empreendimentoId: entrada.empreendimentoId ?? null, titulo: entrada.titulo } }, deps.relogio);
  return { path, ...await deps.armazenamento.criarUrlAssinada(path), comprovante };
}
export async function assinarDocumento(entrada: DocumentoInput, usuarioId: string, deps: DependenciasEnvio = padrao) {
  const db = await deps.criarSessao();
  await conferirPais(db, entrada, "fornecedor_documento");
  const registroId = deps.novoId();
  const extensao = entrada.mime === "application/pdf" ? "pdf" : entrada.mime === "image/jpeg" ? "jpg" : "png";
  const path = `${entrada.fornecedorId}/documentos/${registroId}.${extensao}`;
  const comprovante = assinarComprovante({ finalidade: "fornecedor_documento", bucket: "fornecedores", usuarioId, registroId, path, mime: entrada.mime, tamanho: entrada.tamanho, metadados: { fornecedorId: entrada.fornecedorId, empreendimentoId: entrada.empreendimentoId ?? null, titulo: entrada.titulo, tipo: entrada.tipo } }, deps.relogio);
  return { path, ...await deps.armazenamento.criarUrlAssinada(path), comprovante };
}

const existenteSchema = z.object({ id: z.uuid(), fornecedor_id: z.uuid(), storage_path: z.string(), mime: z.string(), tamanho: z.coerce.number().int().positive(), enviado_por: z.uuid().optional() });
async function existente(db: Awaited<ReturnType<typeof createClient>>, comprovante: Comprovante) {
  const documento = comprovante.finalidade === "fornecedor_documento";
  const { data, error } = await db.from(documento ? "fornecedor_documentos" : "fornecedor_contratos").select(`id,fornecedor_id,storage_path,mime,tamanho::text${documento ? ",enviado_por" : ""}`).eq("id", comprovante.registroId).maybeSingle();
  conferirErro(error);
  if (!data) return null;
  const linha = ler(existenteSchema, data as unknown);
  if (linha.fornecedor_id !== comprovante.metadados.fornecedorId || linha.storage_path !== comprovante.path || linha.mime !== comprovante.mime || linha.tamanho !== comprovante.tamanho || (documento && linha.enviado_por !== comprovante.usuarioId)) throw new ConflictError("Este envio já foi utilizado.");
  return { id: linha.id };
}

export async function confirmarEnvio(token: string, usuarioId: string, finalidade: Finalidade, deps: DependenciasEnvio = padrao): Promise<{ id: string }> {
  const comprovante = validarComprovante(token, usuarioId, deps.relogio);
  if (comprovante.finalidade !== finalidade || (comprovante.finalidade !== "fornecedor_contrato" && comprovante.finalidade !== "fornecedor_documento")) throw new BadRequestError("Comprovante de outro tipo de envio.");
  const db = await deps.criarSessao();
  const jaExiste = await existente(db, comprovante);
  if (jaExiste) return jaExiste;
  const descartar = async (motivo: string): Promise<never> => {
    // Uma confirmação concorrente pode ter terminado enquanto os bytes eram lidos.
    if (!await existente(db, comprovante)) await deps.armazenamento.removerObjeto(comprovante.path).catch(() => console.error("[fornecedor] falha ao remover envio inválido"));
    throw new BadRequestError(motivo);
  };
  if (finalidade === "fornecedor_contrato" && await deps.contratoExcluido(comprovante.registroId)) return descartar("Contrato excluído. Inicie um novo envio.");
  try { await conferirPais(db, { ...comprovante.metadados, tamanho: comprovante.tamanho }, finalidade); }
  catch (error) { if (error instanceof BadRequestError) return descartar("Fornecedor ou empreendimento indisponível."); throw error; }
  const objeto = await deps.armazenamento.abrirObjeto(comprovante.path);
  if (!objeto) throw new BadRequestError("Arquivo não encontrado. Inicie um novo envio.");
  try { await validarArquivoFornecedor(objeto.stream, comprovante.tamanho, comprovante.mime, objeto.contentType); }
  catch (error) {
    if (error instanceof ArquivoFornecedorInvalido) return descartar(error.message);
    throw new InternalServerError(null);
  }
  if (comprovante.finalidade === "fornecedor_documento") {
    const { data, error } = await db.rpc("enviar_documento_fornecedor", { p_id: comprovante.registroId, p_fornecedor: comprovante.metadados.fornecedorId, p_empreendimento: comprovante.metadados.empreendimentoId ?? null, p_tipo: comprovante.metadados.tipo, p_titulo: comprovante.metadados.titulo, p_path: comprovante.path, p_mime: comprovante.mime, p_tamanho: comprovante.tamanho });
    if (error?.code === "23514" || error?.code === "42501") return descartar("Envio indisponível. Confira o vínculo e inicie um novo envio.");
    conferirErro(error);
    return { id: ler(z.uuid(), data as unknown) };
  }
  const { error } = await db.from("fornecedor_contratos").insert({ id: comprovante.registroId, fornecedor_id: comprovante.metadados.fornecedorId, empreendimento_id: comprovante.metadados.empreendimentoId ?? null, titulo: comprovante.metadados.titulo, storage_path: comprovante.path, mime: comprovante.mime, tamanho: comprovante.tamanho });
  if (error?.code === "23505") {
    const concorrente = await existente(db, comprovante);
    if (concorrente) return concorrente;
  }
  if (error?.code === "23514" || error?.code === "23503") return descartar("Fornecedor ou empreendimento indisponível.");
  conferirErro(error);
  return { id: comprovante.registroId };
}
