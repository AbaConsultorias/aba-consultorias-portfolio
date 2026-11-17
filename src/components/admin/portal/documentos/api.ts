import { LIMITE_PDF_BYTES } from "@/lib/portal/documentos/regras";

export type Resposta<T = unknown> = { ok: boolean; details: T | null; erro: string | null; erros: Record<string, string> };

const ERRO_DE_REDE = "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";
const ERRO_GENERICO = "Não foi possível concluir. Tente novamente.";

function primeiroTexto(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (typeof valor !== "object" || valor === null) return null;
  for (const filho of Object.values(valor)) {
    const texto = primeiroTexto(filho);
    if (texto) return texto;
  }
  return null;
}

async function paraResposta<T>(res: Response): Promise<Resposta<T>> {
  let corpo: { details?: unknown } = {};
  try {
    const json: unknown = await res.json();
    if (typeof json === "object" && json !== null) corpo = json;
  } catch {
    corpo = {};
  }
  if (res.ok) return { ok: true, details: (corpo.details ?? null) as T | null, erro: null, erros: {} };

  const erros: Record<string, string> = {};
  if (typeof corpo.details === "object" && corpo.details !== null) {
    for (const [campo, valor] of Object.entries(corpo.details)) {
      const texto = primeiroTexto(valor);
      if (texto) erros[campo] = texto;
    }
  }
  return { ok: false, details: null, erro: primeiroTexto(corpo.details) ?? ERRO_GENERICO, erros };
}

// `adminPath` chega por prop do Server Component; nunca fica em código público.
export async function chamarPortal<T = unknown>(
  adminPath: string,
  caminho: string,
  metodo: "GET" | "POST" | "PATCH" | "DELETE",
  corpo?: unknown,
): Promise<Resposta<T>> {
  try {
    const res = await fetch(`/${adminPath}/api/portal/${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return await paraResposta<T>(res);
  } catch {
    return { ok: false, details: null, erro: ERRO_DE_REDE, erros: {} };
  }
}

// Só os cabeçalhos devolvidos pelo servidor: o CORS do balde recusa qualquer outro.
// XMLHttpRequest em vez de fetch só para ter o progresso do envio.
function enviarParaStorage(url: string, cabecalhos: Record<string, string>, arquivo: File, aoProgredir: (fracao: number) => void) {
  return new Promise<boolean>((resolve) => {
    const requisicao = new XMLHttpRequest();
    requisicao.open("PUT", url);
    for (const [nome, valor] of Object.entries(cabecalhos)) requisicao.setRequestHeader(nome, valor);
    requisicao.upload.onprogress = (evento) => {
      if (evento.lengthComputable) aoProgredir(evento.loaded / evento.total);
    };
    requisicao.onload = () => resolve(requisicao.status >= 200 && requisicao.status < 300);
    requisicao.onerror = () => resolve(false);
    requisicao.onabort = () => resolve(false);
    requisicao.send(arquivo);
  });
}

export type DadosDocumento = { empreendimentoId: string; projetoId: string | null; categoriaId: string | null; titulo: string };

export async function validarPdfLocal(arquivo: File): Promise<string | null> {
  if (arquivo.size === 0) return "O arquivo está vazio.";
  if (arquivo.size > LIMITE_PDF_BYTES) return "O PDF passa do limite de 100 MB.";
  const inicio = new Uint8Array(await arquivo.slice(0, 5).arrayBuffer());
  return new TextDecoder().decode(inicio) === "%PDF-" ? null : "O arquivo não é um PDF válido.";
}

// O servidor assina o PUT com o SHA-256: o R2 só aceita o arquivo se o conteúdo for exatamente este.
async function calcularSha256(arquivo: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer()));
    return Array.from(resumo, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// Quatro passos: o navegador calcula o SHA-256, a rota assina, o navegador envia direto ao R2 e a rota confere o objeto e grava o documento.
export async function enviarPdf(
  adminPath: string,
  dados: DadosDocumento,
  arquivo: File,
  aoProgredir: (fracao: number) => void,
): Promise<Resposta<{ id: string }>> {
  const falhaLocal = await validarPdfLocal(arquivo);
  if (falhaLocal) return { ok: false, details: null, erro: falhaLocal, erros: {} };

  const sha256 = await calcularSha256(arquivo);
  if (!sha256) return { ok: false, details: null, erro: "Não foi possível conferir o arquivo neste navegador. Tente em outro.", erros: {} };

  const assinatura = await chamarPortal<{ url: string; cabecalhos: Record<string, string>; comprovante: string }>(
    adminPath, "documentos/upload/assinar", "POST",
    { ...dados, mime: "application/pdf", tamanho: arquivo.size, sha256 },
  );
  if (!assinatura.ok || !assinatura.details) return { ok: false, details: null, erro: Object.values(assinatura.erros)[0] ?? assinatura.erro, erros: assinatura.erros };

  if (!await enviarParaStorage(assinatura.details.url, assinatura.details.cabecalhos, arquivo, aoProgredir)) {
    return { ok: false, details: null, erro: "Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.", erros: {} };
  }

  // Confirmar é repetível: repetir devolve o mesmo documento.
  const corpo = { comprovante: assinatura.details.comprovante };
  const primeira = await chamarPortal<{ id: string }>(adminPath, "documentos/upload/confirmar", "POST", corpo);
  return primeira.ok || primeira.erro !== ERRO_DE_REDE ? primeira : chamarPortal<{ id: string }>(adminPath, "documentos/upload/confirmar", "POST", corpo);
}
