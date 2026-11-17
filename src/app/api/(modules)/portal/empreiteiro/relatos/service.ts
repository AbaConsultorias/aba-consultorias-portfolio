import "server-only";
import z from "zod";
import { BadRequestError, ConflictError, NotFoundError } from "@/app/api/HttpErrors";
import { validarComprovante, type ComprovanteUpload } from "@/lib/portal/comum/upload";
import { EXTENSOES_FOTO, FotoInvalida, lerFotoLimitada, validarBytesFoto } from "@/lib/portal/andamento/fotos";
import { ler } from "@/lib/portal/andamento/servidor";
import { conferirErro } from "@/lib/portal/obras/erros";
import { enviarSchema, type EnviarRelatoInput } from "./schema";
import { dependenciasPadrao, type DependenciasRelato } from "./armazenamento";

type ComprovanteFoto = Extract<ComprovanteUpload, { finalidade: "relato_foto" }>;
type Sessao = Awaited<ReturnType<DependenciasRelato["sessao"]>>;
export async function exigirObra(sessao: Sessao, obraId: string) {
  const { data, error } = await sessao.from("obras").select("id").eq("id", obraId).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Obra não encontrada.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
export function conferirComprovantes(entrada: EnviarRelatoInput, usuarioId: string): ComprovanteFoto[] {
  const fotos = entrada.comprovantes.map((token) => {
    const foto = validarComprovante(token, usuarioId);
    if (foto.finalidade !== "relato_foto" || foto.metadados.obraId !== entrada.obraId || foto.metadados.relatoId !== entrada.relatoId) throw new BadRequestError("Comprovante incompatível com este relato.");
    if (foto.path !== `relatos/${entrada.obraId}/${entrada.relatoId}/${foto.registroId}.${EXTENSOES_FOTO[foto.mime]}`) throw new BadRequestError("Caminho de foto inválido.");
    return foto;
  });
  if (new Set(fotos.map((foto) => foto.registroId)).size !== fotos.length || new Set(fotos.map((foto) => foto.path)).size !== fotos.length || new Set(fotos.map((foto) => foto.metadados.ordem)).size !== fotos.length) throw new BadRequestError("Há fotos repetidas no envio.");
  return fotos;
}
const fotoPersistidaSchema = z.object({ id: z.uuid(), storage_path: z.string(), mime: z.string(), tamanho: z.string() });
const relatoPersistidoSchema = z.object({ id: z.uuid(), obra_id: z.uuid(), autor_id: z.uuid(), texto: z.string(), percentual_informado: z.number().nullable(), situacao_informada: z.string().nullable(), relato_fotos: fotoPersistidaSchema.array() });
async function obterExistente(sessao: Sessao, id: string) {
  const { data, error } = await sessao.from("relatos_obra").select("id,obra_id,autor_id,texto,percentual_informado,situacao_informada,relato_fotos(id,storage_path,mime,tamanho::text)").eq("id", id).maybeSingle();
  conferirErro(error);
  return data ? ler(relatoPersistidoSchema, data as unknown) : null;
}
export async function enviar(entrada: EnviarRelatoInput, usuarioId: string, deps = dependenciasPadrao) {
  const validacao = enviarSchema.safeParse(entrada);
  if (!validacao.success) throw new BadRequestError("Confira os dados do relato.");
  entrada = validacao.data;
  const sessao = await deps.sessao();
  await exigirObra(sessao, entrada.obraId);
  const fotos = conferirComprovantes(entrada, usuarioId);
  const existente = await obterExistente(sessao, entrada.relatoId);
  if (existente) {
    const compativel = existente.obra_id === entrada.obraId && existente.autor_id === usuarioId && existente.texto === entrada.texto && existente.percentual_informado === entrada.percentualInformado && existente.situacao_informada === entrada.situacaoInformada && existente.relato_fotos.length === fotos.length && fotos.every((foto) => existente.relato_fotos.some((linha) => linha.id === foto.registroId && linha.storage_path === foto.path && linha.mime === foto.mime && linha.tamanho === String(foto.tamanho)));
    if (!compativel) throw new ConflictError("Este envio já foi concluído com outro conteúdo. Inicie um novo relato.");
    return { id: existente.id };
  }
  try {
    for (const foto of fotos) {
      const objeto = await deps.lerObjeto(foto.path);
      const bytes = await lerFotoLimitada(objeto.stream, foto.tamanho);
      if (objeto.mime !== foto.mime || !validarBytesFoto(bytes, foto.mime)) throw new FotoInvalida("O conteúdo de uma foto não corresponde ao formato informado.");
    }
  } catch (error) {
    if (!(error instanceof FotoInvalida) && !(error instanceof BadRequestError)) throw error;
    // Reconfere acesso e referências para nunca apagar fotos de um envio já aceito.
    await exigirObra(sessao, entrada.obraId);
    if (!(await obterExistente(sessao, entrada.relatoId))) {
      const { data, error: erroReferencias } = await sessao.from("relato_fotos").select("storage_path").in("storage_path", fotos.map((foto) => foto.path));
      conferirErro(erroReferencias);
      const referencias = new Set(ler(z.object({ storage_path: z.string() }).array(), data as unknown).map((linha) => linha.storage_path));
      await deps.apagar(fotos.filter((foto) => !referencias.has(foto.path)).map((foto) => foto.path));
    }
    throw error instanceof FotoInvalida ? new BadRequestError(error.message) : error;
  }
  const { data, error } = await sessao.rpc("enviar_relato_obra", {
    p_obra: entrada.obraId, p_relato: entrada.relatoId, p_texto: entrada.texto,
    p_percentual: entrada.percentualInformado, p_situacao: entrada.situacaoInformada,
    p_fotos: fotos.map((foto) => ({ id: foto.registroId, path: foto.path, mime: foto.mime, tamanho: foto.tamanho })),
  });
  conferirErro(error);
  return { id: ler(z.uuid(), data as unknown) };
}
