import "server-only";
import { AwsClient } from "aws4fetch";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";

const TEMPO_LIMITE_MS = 15_000;
const SEGUNDOS_MAXIMOS = 3600;
// Cabeçalhos que o CORS dos baldes libera para o PUT do navegador; qualquer outro assinado quebraria o envio.
const CABECALHOS_ASSINADOS_PERMITIDOS = new Set(["host", "content-length", "content-type", "x-amz-checksum-sha256"]);

const configuracaoSchema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/),
  R2_ACCESS_KEY_ID: z.string().regex(/^[\x21-\x7e]{8,256}$/),
  R2_SECRET_ACCESS_KEY: z.string().regex(/^[\x21-\x7e]{8,256}$/),
  R2_BUCKET_DOCUMENTOS: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
});

export type EnvioAssinado = { url: string; cabecalhos: Record<string, string> };
export type InfoObjeto = { tamanho: number; sha256Base64: string | null; contentType: string | null };
export type ObjetoListado = { chave: string; tamanho: number; modificadoEm: Date };
export type PaginaListada = { objetos: ObjetoListado[]; proximo: string | null };

type Configuracao = { cliente: AwsClient; base: string };
let configuracao: Configuracao | null = null;

function obterConfiguracao(): Configuracao {
  if (configuracao) return configuracao;
  const resultado = configuracaoSchema.safeParse(process.env);
  if (!resultado.success) {
    const variaveis = [...new Set(resultado.error.issues.map((problema) => String(problema.path[0])))];
    console.error("[r2] variável de ambiente ausente ou inválida:", variaveis.join(", "));
    throw new InternalServerError(null);
  }
  const env = resultado.data;
  configuracao = {
    cliente: new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" }),
    base: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_DOCUMENTOS}`,
  };
  return configuracao;
}

function falha(operacao: string, detalhe: string | number): never {
  console.error("[r2]", operacao, detalhe);
  throw new InternalServerError(null);
}

function codificarSegmento(segmento: string): string {
  return encodeURIComponent(segmento).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function urlDoObjeto(chave: string): URL {
  const valida = chave.length > 0 && chave.length <= 1024
    && !/[\\\u0000-\u001f\u007f]/.test(chave)
    && chave.split("/").every((parte) => parte !== "" && parte !== "." && parte !== "..");
  if (!valida) falha("chave inválida", chave.length);
  return new URL(`${obterConfiguracao().base}/${chave.split("/").map(codificarSegmento).join("/")}`);
}

function segundosValidos(segundos: number): string {
  if (!Number.isInteger(segundos) || segundos < 1 || segundos > SEGUNDOS_MAXIMOS) falha("validade inválida", segundos);
  return String(segundos);
}

// URLSearchParams grava o espaço como "+"; o valor de response-content-disposition chegaria ao navegador com o sinal.
function espacosPercentuais(url: URL): string {
  const [caminho, consulta] = url.toString().split("?");
  return consulta === undefined ? caminho : `${caminho}?${consulta.replace(/\+/g, "%20")}`;
}

async function assinar(url: URL, metodo: "GET" | "HEAD" | "PUT" | "DELETE", cabecalhos?: Record<string, string>, aws?: { signQuery: true; allHeaders?: true }): Promise<Request> {
  return obterConfiguracao().cliente.sign(url.toString(), { method: metodo, headers: cabecalhos, aws });
}

async function enviar(requisicao: Request, operacao: string): Promise<Response> {
  try {
    return await fetch(requisicao, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  } catch (error) {
    return falha(`${operacao}: falha de rede`, error instanceof Error ? error.name : "desconhecida");
  }
}

// PUT que o navegador faz direto ao R2. Tamanho, tipo e SHA-256 vão assinados: conteúdo diferente do declarado é recusado pelo R2.
export async function presignPut(chave: string, objeto: { tamanho: number; sha256Base64: string }, segundos = 300): Promise<EnvioAssinado> {
  if (!Number.isSafeInteger(objeto.tamanho) || objeto.tamanho <= 0) falha("presignPut: tamanho inválido", objeto.tamanho);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(objeto.sha256Base64)) falha("presignPut: checksum inválido", objeto.sha256Base64.length);
  const url = urlDoObjeto(chave);
  url.searchParams.set("X-Amz-Expires", segundosValidos(segundos));
  const cabecalhos = {
    "content-length": String(objeto.tamanho),
    "content-type": "application/pdf",
    "x-amz-checksum-sha256": objeto.sha256Base64,
  };
  const assinada = await assinar(url, "PUT", cabecalhos, { signQuery: true, allHeaders: true });
  const assinados = new URL(assinada.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
  if (!assinados.includes("content-length") || !assinados.includes("x-amz-checksum-sha256")
    || assinados.some((nome) => !CABECALHOS_ASSINADOS_PERMITIDOS.has(nome))) {
    falha("presignPut: cabeçalhos assinados inesperados", assinados.join(";"));
  }
  return {
    url: assinada.url,
    // content-length o navegador define sozinho, com o tamanho do arquivo.
    cabecalhos: { "content-type": cabecalhos["content-type"], "x-amz-checksum-sha256": cabecalhos["x-amz-checksum-sha256"] },
  };
}

// RFC 6266 + 5987: filename ASCII de reserva e filename* em UTF-8 para nomes com acento.
export function contentDisposition(nomeArquivo: string, anexo: boolean): string {
  const reserva = nomeArquivo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ._-]/g, "_");
  const utf8 = encodeURIComponent(nomeArquivo).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${anexo ? "attachment" : "inline"}; filename="${reserva}"; filename*=UTF-8''${utf8}`;
}

export async function presignGet(chave: string, segundos: number, opcoes: { nomeArquivo: string; anexo: boolean }): Promise<string> {
  const url = urlDoObjeto(chave);
  url.searchParams.set("X-Amz-Expires", segundosValidos(segundos));
  url.searchParams.set("response-content-disposition", contentDisposition(opcoes.nomeArquivo, opcoes.anexo));
  url.searchParams.set("response-content-type", "application/pdf");
  const assinada = await assinar(url, "GET", undefined, { signQuery: true });
  return espacosPercentuais(new URL(assinada.url));
}

export async function head(chave: string): Promise<InfoObjeto | null> {
  const resposta = await enviar(await assinar(urlDoObjeto(chave), "HEAD", { "x-amz-checksum-mode": "ENABLED" }), "head");
  if (resposta.status === 404) return null;
  if (!resposta.ok) return falha("head:", resposta.status);
  const tamanho = Number(resposta.headers.get("content-length"));
  if (!Number.isSafeInteger(tamanho) || tamanho < 0) return falha("head: content-length inválido", resposta.status);
  return { tamanho, sha256Base64: resposta.headers.get("x-amz-checksum-sha256"), contentType: resposta.headers.get("content-type") };
}

// null = objeto ausente. Objeto vazio devolve zero bytes (a faixa não é satisfazível).
export async function lerFaixa(chave: string, inicio: number, fim: number): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fim) || inicio < 0 || fim < inicio) falha("lerFaixa: faixa inválida", `${inicio}-${fim}`);
  const resposta = await enviar(await assinar(urlDoObjeto(chave), "GET", { range: `bytes=${inicio}-${fim}` }), "lerFaixa");
  if (resposta.status === 404) return null;
  if (resposta.status === 416) return new Uint8Array(0);
  if (resposta.status !== 206 && resposta.status !== 200) return falha("lerFaixa:", resposta.status);
  const maximo = fim - inicio + 1;
  const leitor = resposta.body?.getReader();
  if (!leitor) return new Uint8Array(0);
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maximo) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    return falha("lerFaixa: falha ao ler o corpo", error instanceof Error ? error.name : "desconhecida");
  } finally {
    // Sem await: no fetch do Next o cancel de um corpo já lido fica pendente até o timeout (15 s).
    void leitor.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    bytes.set(parte, posicao);
    posicao += parte.byteLength;
  }
  return bytes.subarray(0, maximo);
}

// Idempotente: apagar objeto ausente não é erro.
export async function remover(chave: string): Promise<void> {
  const resposta = await enviar(await assinar(urlDoObjeto(chave), "DELETE"), "remover");
  if (!resposta.ok && resposta.status !== 404) falha("remover:", resposta.status);
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function desescaparXml(texto: string): string {
  return texto.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_, decimal?: string, hexa?: string, nome?: string) => {
    if (nome) return ENTIDADES[nome];
    return String.fromCodePoint(Number.parseInt(decimal ?? hexa ?? "0", decimal ? 10 : 16));
  });
}

function campoXml(bloco: string, nome: string): string | null {
  const achado = new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`).exec(bloco);
  return achado ? desescaparXml(achado[1]) : null;
}

export async function listar(prefixo?: string, continuationToken?: string): Promise<PaginaListada> {
  const url = new URL(obterConfiguracao().base);
  url.searchParams.set("list-type", "2");
  if (prefixo) url.searchParams.set("prefix", prefixo);
  if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
  const resposta = await enviar(await assinar(url, "GET"), "listar");
  if (!resposta.ok) return falha("listar:", resposta.status);
  const xml = await resposta.text();
  const objetos: ObjetoListado[] = [];
  for (const [, bloco] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const chave = campoXml(bloco, "Key");
    const tamanho = Number(campoXml(bloco, "Size") ?? Number.NaN);
    const modificadoEm = new Date(campoXml(bloco, "LastModified") ?? "");
    if (!chave || !Number.isSafeInteger(tamanho) || Number.isNaN(modificadoEm.getTime())) return falha("listar: item inválido", resposta.status);
    objetos.push({ chave, tamanho, modificadoEm });
  }
  const truncado = campoXml(xml, "IsTruncated") === "true";
  const proximo = truncado ? campoXml(xml, "NextContinuationToken") : null;
  if (truncado && !proximo) return falha("listar: continuação ausente", resposta.status);
  return { objetos, proximo };
}
