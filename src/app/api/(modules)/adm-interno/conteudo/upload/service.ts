import { randomUUID } from "node:crypto";
import { BadRequestError, InternalServerError, TooManyRequestsError } from "@/app/api/HttpErrors";
import { limitar } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sanitizarSvg } from "@/lib/svg/sanitizar";
import {
  EXTENSAO_POR_MIME,
  type ApagarArquivoInput,
  type AssinarInput,
  type ConfirmarInput,
  type MapaInput,
} from "./schema";

const BUCKET = "site-publico";
const MB = 1024 * 1024;
const BYTES_CONFERIDOS = 64;

export const LIMITES_BYTES = { imagem: 10 * MB, video: 15 * MB, mapa: 2 * MB } as const;

const TABELA_DO_DONO = { portfolio: "portfolio_projetos", loteamentos: "loteamentos" } as const;

type TipoReal = { mime: string; extensao: string; tipo: "imagem" | "video" };

const TIPO_POR_EXTENSAO: Record<string, TipoReal> = {
  jpg: { mime: "image/jpeg", extensao: "jpg", tipo: "imagem" },
  png: { mime: "image/png", extensao: "png", tipo: "imagem" },
  webp: { mime: "image/webp", extensao: "webp", tipo: "imagem" },
  mp4: { mime: "video/mp4", extensao: "mp4", tipo: "video" },
};

function comecaCom(bytes: Uint8Array, assinatura: number[], deslocamento = 0) {
  return assinatura.every((byte, i) => bytes[deslocamento + i] === byte);
}

function detectarTipo(bytes: Uint8Array): TipoReal | null {
  if (comecaCom(bytes, [0xff, 0xd8, 0xff])) return TIPO_POR_EXTENSAO.jpg;
  if (comecaCom(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return TIPO_POR_EXTENSAO.png;
  if (comecaCom(bytes, [0x52, 0x49, 0x46, 0x46]) && comecaCom(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return TIPO_POR_EXTENSAO.webp;
  }
  if (comecaCom(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return TIPO_POR_EXTENSAO.mp4;
  return null;
}

export async function exigirLimiteDeEnvio(usuarioId: string) {
  if (!(await limitar(`upload:${usuarioId}`, 30, 10 * 60))) {
    throw new TooManyRequestsError("Muitos envios seguidos. Tente novamente em alguns minutos.");
  }
}

// Chave própria: cada envio direto faz assinar + confirmar, e a confirmação
// não deve consumir o limite de envios.
export async function exigirLimiteDeConfirmacao(usuarioId: string) {
  if (!(await limitar(`upload-confirmar:${usuarioId}`, 60, 10 * 60))) {
    throw new TooManyRequestsError("Muitos envios seguidos. Tente novamente em alguns minutos.");
  }
}

async function exigirDono({ destino, donoId }: { destino: AssinarInput["destino"]; donoId?: string }) {
  if (destino !== "portfolio" && destino !== "loteamentos") return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(TABELA_DO_DONO[destino])
    .select("id")
    .eq("id", donoId)
    .maybeSingle();

  if (error) {
    console.error("[upload] falha ao conferir o dono:", error.code);
    throw new InternalServerError(null);
  }
  if (!data) {
    throw new BadRequestError("Registro não encontrado. Salve o cadastro antes de enviar arquivos.");
  }
}

function novoCaminho(destino: string, donoId: string | undefined, extensao: string) {
  const pasta = donoId ? `${destino}/${donoId}` : destino;
  return `${pasta}/${randomUUID()}.${extensao}`;
}

function limiteEmMb(tipo: keyof typeof LIMITES_BYTES) {
  return `O arquivo passa do limite de ${LIMITES_BYTES[tipo] / MB} MB.`;
}

export async function assinarEnvio(entrada: AssinarInput) {
  if (entrada.tamanho > LIMITES_BYTES[entrada.tipo]) throw new BadRequestError(limiteEmMb(entrada.tipo));
  await exigirDono(entrada);

  const path = novoCaminho(entrada.destino, entrada.donoId, EXTENSAO_POR_MIME[entrada.mime]);
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[upload] falha ao assinar o envio:", error?.message);
    throw new InternalServerError(null);
  }

  return { path, token: data.token, signedUrl: data.signedUrl };
}

type Storage = ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>;

// Lê só o começo do arquivo e corta o download: o vídeo pode ter 15 MB.
async function lerInicio(storage: Storage, path: string) {
  const controle = new AbortController();
  const { data, error } = await storage.download(path, {}, { signal: controle.signal }).asStream();
  if (error || !data) return null;

  const leitor = (data as ReadableStream<Uint8Array>).getReader();
  const bytes = new Uint8Array(BYTES_CONFERIDOS);
  let lidos = 0;
  try {
    while (lidos < BYTES_CONFERIDOS) {
      const { done, value } = await leitor.read();
      if (done) break;
      const parte = value.subarray(0, BYTES_CONFERIDOS - lidos);
      bytes.set(parte, lidos);
      lidos += parte.length;
    }
  } catch {
    return null;
  } finally {
    controle.abort();
    leitor.cancel().catch(() => undefined);
  }
  return bytes.subarray(0, lidos);
}

async function arquivoConfere(storage: Storage, path: string, esperado: TipoReal, exigirContentType = false) {
  const { data: info, error } = await storage.info(path);
  if (error || !info) return false;

  const tamanho = info.size;
  if (typeof tamanho !== "number" || tamanho <= 0 || tamanho > LIMITES_BYTES[esperado.tipo]) return false;
  if (exigirContentType && !info.contentType) return false;
  if (info.contentType && info.contentType !== esperado.mime) return false;

  const inicio = await lerInicio(storage, path);
  return inicio !== null && detectarTipo(inicio)?.mime === esperado.mime;
}

// O navegador enviou direto ao storage; aqui conferimos o que chegou de fato
// (tamanho, tipo declarado e bytes reais). Se não bater, o arquivo é apagado.
export async function confirmarEnvio({ path }: ConfirmarInput) {
  const esperado = TIPO_POR_EXTENSAO[path.slice(path.lastIndexOf(".") + 1)];
  const storage = createAdminClient().storage.from(BUCKET);

  if (esperado && (await arquivoConfere(storage, path, esperado))) return { path };

  const { error } = await storage.remove([path]);
  if (error) console.error("[upload] falha ao apagar envio recusado:", error.message);
  throw new BadRequestError(
    esperado?.tipo === "video"
      ? `Envie um vídeo MP4 de até ${LIMITES_BYTES.video / MB} MB.`
      : `Envie uma imagem JPEG, PNG ou WebP de até ${LIMITES_BYTES.imagem / MB} MB.`,
  );
}

// A URL assinada não limita tipo nem tamanho, e o caminho gravado no cadastro
// vira mídia pública: o objeto é conferido de novo antes de gravar. Aqui, ao
// contrário da confirmação, objeto sem content-type é recusado. Caminho vazio
// ou igual ao já gravado (`atual`) não é conferido.
export async function exigirArquivoConferido(
  caminho: string | null | undefined,
  tipo: "imagem" | "video",
  atual?: string | null,
) {
  if (!caminho || caminho === atual) return;

  const esperado = TIPO_POR_EXTENSAO[caminho.slice(caminho.lastIndexOf(".") + 1)];
  const storage = createAdminClient().storage.from(BUCKET);

  if (esperado?.tipo === tipo && (await arquivoConfere(storage, caminho, esperado, true))) return;

  throw new BadRequestError(
    tipo === "video"
      ? `O arquivo não é um vídeo MP4 válido de até ${LIMITES_BYTES.video / MB} MB. Envie-o novamente.`
      : `O arquivo não é uma imagem JPEG, PNG ou WebP válida de até ${LIMITES_BYTES.imagem / MB} MB. Envie-a novamente.`,
  );
}

export async function enviarMapa(entrada: MapaInput, arquivo: File) {
  await exigirDono(entrada);

  if (arquivo.size === 0) throw new BadRequestError("O arquivo está vazio.");
  if (arquivo.size > LIMITES_BYTES.mapa) throw new BadRequestError(limiteEmMb("mapa"));

  const limpo = sanitizarSvg(await arquivo.text());
  if (!limpo) {
    throw new BadRequestError("O arquivo não é um mapa SVG válido ou não tem nenhum desenho.");
  }

  const path = novoCaminho(entrada.destino, entrada.donoId, "svg");
  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .upload(path, new TextEncoder().encode(limpo), { contentType: "image/svg+xml", upsert: false });

  if (error) {
    console.error("[upload] falha ao gravar no storage:", error.message);
    throw new InternalServerError(null);
  }

  return { path };
}

export async function apagarArquivo({ path }: ApagarArquivoInput, usuarioId: string) {
  await exigirLimiteDeEnvio(usuarioId);

  const { error } = await createAdminClient().storage.from(BUCKET).remove([path]);

  if (error) {
    console.error("[upload] falha ao apagar do storage:", error.message);
    throw new InternalServerError(null);
  }
}
