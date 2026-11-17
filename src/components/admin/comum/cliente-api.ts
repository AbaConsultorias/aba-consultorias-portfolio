export type RespostaApi<T = unknown> = {
  ok: boolean;
  details: T | null;
  erro: string | null;
  // Erros de validação por campo: { nome: "Informe o nome." }
  erros: Record<string, string>;
};

type Metodo = "POST" | "PUT" | "PATCH" | "DELETE";

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

function errosPorCampo(details: unknown) {
  const erros: Record<string, string> = {};
  if (typeof details !== "object" || details === null) return erros;

  for (const [campo, valor] of Object.entries(details)) {
    const texto = primeiroTexto(valor);
    if (texto) erros[campo] = texto;
  }
  return erros;
}

async function lerCorpo(res: Response): Promise<{ message?: unknown; details?: unknown }> {
  try {
    const json: unknown = await res.json();
    return typeof json === "object" && json !== null ? json : {};
  } catch {
    return {};
  }
}

async function paraResposta<T>(res: Response): Promise<RespostaApi<T>> {
  const corpo = await lerCorpo(res);

  if (res.ok) {
    return { ok: true, details: (corpo.details ?? null) as T | null, erro: null, erros: {} };
  }

  const ehValidacao = typeof corpo.details === "object" && corpo.details !== null;
  return {
    ok: false,
    details: null,
    erro: ehValidacao ? "Confira os campos destacados." : (primeiroTexto(corpo.details) ?? ERRO_GENERICO),
    erros: ehValidacao ? errosPorCampo(corpo.details) : {},
  };
}

function falhaDeRede<T>(): RespostaApi<T> {
  return { ok: false, details: null, erro: ERRO_DE_REDE, erros: {} };
}

// `caminho` é relativo a /<adminPath>/api/conteudo/, ex.: "loteamentos/<id>".
// O adminPath chega por prop do Server Component; nunca fica em código público.
export async function chamarApi<T = unknown>(
  adminPath: string,
  caminho: string,
  metodo: Metodo,
  corpo?: unknown,
): Promise<RespostaApi<T>> {
  try {
    const res = await fetch(`/${adminPath}/api/conteudo/${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return await paraResposta<T>(res);
  } catch {
    return falhaDeRede<T>();
  }
}

export type DadosDoEnvio = {
  destino: "servicos" | "hero" | "parceiros" | "instagram" | "portfolio" | "loteamentos";
  tipo: "imagem" | "video" | "mapa";
  donoId?: string;
};

type Envio = RespostaApi<{ path: string }>;

const MIMES_ACEITOS: Record<"imagem" | "video", readonly string[]> = {
  imagem: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4"],
};

function falhaDeEnvio(erro: string): Envio {
  return { ok: false, details: null, erro, erros: {} };
}

async function enviarMapa(adminPath: string, dados: DadosDoEnvio, arquivo: File): Promise<Envio> {
  const form = new FormData();
  form.append("destino", dados.destino);
  form.append("tipo", dados.tipo);
  if (dados.donoId) form.append("donoId", dados.donoId);
  form.append("arquivo", arquivo);

  try {
    const res = await fetch(`/${adminPath}/api/conteudo/upload`, { method: "POST", body: form });
    return await paraResposta<{ path: string }>(res);
  } catch {
    return falhaDeRede();
  }
}

// XMLHttpRequest em vez de fetch só para ter o progresso do envio.
function enviarParaStorage(signedUrl: string, arquivo: File, aoProgredir?: (fracao: number) => void) {
  return new Promise<boolean>((resolve) => {
    const requisicao = new XMLHttpRequest();
    requisicao.open("PUT", signedUrl);
    requisicao.setRequestHeader("Content-Type", arquivo.type);
    requisicao.setRequestHeader("x-upsert", "false");
    // Cada envio ganha um caminho novo com UUID e nunca é sobrescrito (x-upsert false).
    requisicao.setRequestHeader("cache-control", "max-age=31536000");
    const chavePublica = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (chavePublica) requisicao.setRequestHeader("apikey", chavePublica);
    if (aoProgredir) {
      requisicao.upload.onprogress = (evento) => {
        if (evento.lengthComputable) aoProgredir(evento.loaded / evento.total);
      };
    }
    requisicao.onload = () => resolve(requisicao.status >= 200 && requisicao.status < 300);
    requisicao.onerror = () => resolve(false);
    requisicao.onabort = () => resolve(false);
    requisicao.send(arquivo);
  });
}

// Imagem e vídeo: a rota assina, o navegador envia direto ao storage (sem o
// limite de corpo da Vercel) e a rota confere os bytes que chegaram. Mapa SVG
// passa pela rota, que o sanitiza antes de gravar.
export async function enviarArquivo(
  adminPath: string,
  dados: DadosDoEnvio,
  arquivo: File,
  aoProgredir?: (fracao: number) => void,
): Promise<Envio> {
  if (dados.tipo === "mapa") return enviarMapa(adminPath, dados, arquivo);

  if (!MIMES_ACEITOS[dados.tipo].includes(arquivo.type)) {
    return falhaDeEnvio(dados.tipo === "imagem" ? "Envie uma imagem JPEG, PNG ou WebP." : "Envie um vídeo MP4.");
  }

  const assinatura = await chamarApi<{ path: string; signedUrl: string }>(adminPath, "upload/assinar", "POST", {
    ...dados,
    tamanho: arquivo.size,
    mime: arquivo.type,
  });
  if (!assinatura.ok || !assinatura.details) {
    return falhaDeEnvio(Object.values(assinatura.erros)[0] ?? assinatura.erro ?? ERRO_GENERICO);
  }

  const { path, signedUrl } = assinatura.details;
  if (!(await enviarParaStorage(signedUrl, arquivo, aoProgredir))) {
    return falhaDeEnvio("Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.");
  }

  return chamarApi<{ path: string }>(adminPath, "upload/confirmar", "POST", { path });
}

export function apagarArquivoEnviado(adminPath: string, path: string) {
  return chamarApi(adminPath, "upload", "DELETE", { path });
}
