import "server-only";
import { randomUUID } from "node:crypto";
import z from "zod";
import { BadRequestError, ConflictError, InternalServerError } from "@/app/api/HttpErrors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assinarComprovante, validarComprovante, type ComprovanteUpload, type RelogioUpload } from "@/lib/portal/comum/upload";
import { armazenamentoPadrao, sha256HexParaBase64, type Armazenamento } from "@/lib/portal/documentos/armazenamento";
import { paisValidos, type SessaoDocumentos } from "@/lib/portal/documentos/relacoes";
import { comecaComPdf } from "@/lib/portal/documentos/regras";
import type { AssinarInput, ConfirmarInput } from "./schema";

type Sessao = SessaoDocumentos;
export type DependenciasEnvio = {
  criarSessao: typeof createClient;
  armazenamento: Armazenamento;
  novoId: () => string;
  relogio: RelogioUpload;
  // Só a auditoria lembra de um documento já excluído; ela não é legível pela sessão da equipe.
  registroExcluido: (id: string) => Promise<boolean>;
};

const dependenciasPadrao: DependenciasEnvio = {
  criarSessao: createClient,
  armazenamento: armazenamentoPadrao,
  novoId: randomUUID,
  relogio: { agora: Date.now },
  async registroExcluido(id) {
    const { data, error } = await createAdminClient().from("auditoria").select("registro_id")
      .eq("tabela", "documentos").eq("registro_id", id).eq("acao", "DELETE").limit(1);
    if (error) falhaDeBanco(error);
    return data.length > 0;
  },
};
const COMPROVANTE_INVALIDO = "Comprovante de upload inválido ou expirado.";
const PAIS_INVALIDOS = "Empreendimento, projeto ou categoria não encontrado.";
const existenteSchema = z.object({
  id: z.uuid(),
  empreendimento_id: z.uuid(),
  storage_path: z.string(),
  mime: z.string(),
  tamanho: z.number(),
});

function falhaDeBanco(error: { code?: string }): never {
  console.error("[portal] envio de documento:", error.code);
  throw new InternalServerError(null);
}

export async function assinarEnvio(entrada: AssinarInput, usuarioId: string, dependencias: DependenciasEnvio = dependenciasPadrao) {
  const sessao = await dependencias.criarSessao();
  if (!await paisValidos(sessao, entrada)) throw new BadRequestError(PAIS_INVALIDOS);

  const registroId = dependencias.novoId();
  const path = `${entrada.empreendimentoId}/${registroId}.pdf`;
  // O comprovante vem primeiro: entrada que ele recusa não chega a gerar URL de envio.
  const comprovante = assinarComprovante({
    usuarioId,
    registroId,
    bucket: "documentos",
    path,
    mime: entrada.mime,
    tamanho: entrada.tamanho,
    sha256: entrada.sha256,
    metadados: {
      empreendimentoId: entrada.empreendimentoId,
      projetoId: entrada.projetoId ?? null,
      categoriaId: entrada.categoriaId ?? null,
      titulo: entrada.titulo,
    },
  }, dependencias.relogio);
  const { url, cabecalhos } = await dependencias.armazenamento.criarUrlAssinada(path, { tamanho: entrada.tamanho, sha256: entrada.sha256 });
  return { path, url, cabecalhos, comprovante };
}

const NAO_CHEGOU = "O arquivo não chegou ao armazenamento. Envie novamente.";

// O R2 já recusou conteúdo diferente do assinado no PUT; aqui se confere o que ele guardou (HEAD) e a assinatura do PDF (5 bytes).
async function conferirObjeto(armazenamento: Armazenamento, path: string, tamanho: number, sha256: string): Promise<string | null> {
  const objeto = await armazenamento.consultarObjeto(path);
  if (!objeto) return NAO_CHEGOU;
  const tipo = objeto.contentType?.split(";")[0].trim().toLowerCase();
  if (tipo && tipo !== "application/pdf") return "O arquivo enviado não é um PDF válido.";
  if (objeto.tamanho > tamanho) return "O arquivo enviado é maior que o tamanho informado.";
  if (objeto.tamanho < tamanho || objeto.sha256Base64 !== sha256HexParaBase64(sha256)) return "O arquivo enviado está incompleto. Envie novamente.";
  const cabecalho = await armazenamento.lerCabecalho(path);
  if (!cabecalho) return NAO_CHEGOU;
  return comecaComPdf(cabecalho) ? null : "O arquivo enviado não é um PDF válido.";
}

async function descartar(armazenamento: Armazenamento, path: string, motivo: string): Promise<never> {
  await armazenamento.removerObjeto(path).catch(() => console.error("[portal] envio de documento: falha ao apagar envio recusado"));
  throw new BadRequestError(motivo);
}

async function buscarPorId(sessao: Sessao, id: string) {
  const { data, error } = await sessao.from("documentos").select("id,empreendimento_id,storage_path,mime,tamanho")
    .eq("id", id).maybeSingle();
  if (error) falhaDeBanco(error);
  if (data === null) return null;
  const linha = existenteSchema.safeParse(data as unknown);
  if (!linha.success) throw new InternalServerError(null);
  return linha.data;
}

// Título, projeto e categoria podem ser editados depois da confirmação; só a identidade do arquivo conta.
function compativel(linha: z.infer<typeof existenteSchema>, comprovante: ComprovanteUpload): { id: string } {
  if (linha.storage_path !== comprovante.path || linha.empreendimento_id !== (comprovante.metadados as { empreendimentoId: string }).empreendimentoId
    || linha.mime !== comprovante.mime || linha.tamanho !== comprovante.tamanho) {
    throw new ConflictError("Este envio já foi usado por outro documento.");
  }
  return { id: linha.id };
}

export async function confirmarEnvio(entrada: ConfirmarInput, usuarioId: string, dependencias: DependenciasEnvio = dependenciasPadrao): Promise<{ id: string }> {
  const comprovante = validarComprovante(entrada.comprovante, usuarioId, dependencias.relogio);
  if (comprovante.bucket !== "documentos") throw new BadRequestError(COMPROVANTE_INVALIDO);
  const { metadados, registroId, path, tamanho, mime, sha256 } = comprovante;
  const { armazenamento } = dependencias;
  const sessao = await dependencias.criarSessao();

  const gravado = await buscarPorId(sessao, registroId);
  if (gravado) return compativel(gravado, comprovante);

  // A URL de envio sobrevive à exclusão: sem isto, reenviar ao mesmo path ressuscitaria o documento apagado.
  if (await dependencias.registroExcluido(registroId)) return descartar(armazenamento, path, "Este envio já foi usado por um documento excluído. Inicie um novo envio.");

  if (!await paisValidos(sessao, metadados)) return descartar(armazenamento, path, PAIS_INVALIDOS);

  const recusa = await conferirObjeto(armazenamento, path, tamanho, sha256);
  if (recusa === NAO_CHEGOU) throw new BadRequestError(recusa);
  if (recusa) return descartar(armazenamento, path, recusa);

  const { error } = await sessao.from("documentos").insert({
    id: registroId,
    empreendimento_id: metadados.empreendimentoId,
    projeto_id: metadados.projetoId ?? null,
    categoria_id: metadados.categoriaId ?? null,
    titulo: metadados.titulo,
    storage_path: path,
    mime,
    tamanho,
    sha256,
    liberado_cliente: false,
  });
  if (!error) return { id: registroId };

  // Confirmação concorrente: a PK/path únicos decidem; o objeto referenciado nunca é apagado aqui.
  if (error.code === "23505") {
    const concorrente = await buscarPorId(sessao, registroId);
    if (concorrente) return compativel(concorrente, comprovante);
    throw new ConflictError("Este envio já foi usado por outro documento.");
  }
  if (error.code === "23503" || error.code === "23514") return descartar(armazenamento, path, PAIS_INVALIDOS);
  return falhaDeBanco(error);
}
