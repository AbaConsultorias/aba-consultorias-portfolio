import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { chaveIp, limitar } from "@/lib/rate-limit";

const ROTA_INTERNA_DO_ADMIN = /^\/(?:api\/)?adm-interno(?:[/.]|$)/;
const AREA_SEM_CACHE = /^\/(?:cliente|empreiteiro|fornecedor|trocar-senha)(?:\/|$)/;
const METODOS_SEGUROS = ["GET", "HEAD", "OPTIONS"];
// Única rota que recebe multipart (o mapa SVG); todo o resto da API é JSON.
const ROTA_MULTIPART = "/api/adm-interno/conteudo/upload";

// Caminho que não existe em lugar nenhum: reescrever para ele faz o Next
// responder o mesmo 404 de qualquer URL desconhecida, sem entregar que
// /adm-interno é especial.
const CAMINHO_INEXISTENTE = "/_nao-encontrado";

type RotaAdmin = { destino: string; api: boolean; publica: boolean };

function acessaRotaInternaDoAdmin(pathname: string) {
  let decodificado: string;
  try {
    decodificado = decodeURIComponent(pathname);
  } catch {
    return true;
  }

  return ROTA_INTERNA_DO_ADMIN.test(
    decodificado.replace(/\/{2,}/g, "/").toLowerCase(),
  );
}

// /<ADMIN_PATH>/api/x -> /api/adm-interno/x ; /<ADMIN_PATH>/x -> /adm-interno/x
// Só o login (tela e API) atende quem ainda não tem sessão.
function reescreverRotaDoAdmin(pathname: string, adminPath: string): RotaAdmin | null {
  const prefixo = `/${adminPath}`;
  if (pathname !== prefixo && !pathname.startsWith(`${prefixo}/`)) return null;

  const resto = pathname.slice(prefixo.length);
  if (resto === "/api" || resto.startsWith("/api/")) {
    return { destino: `/api/adm-interno${resto.slice(4)}`, api: true, publica: resto === "/api/entrar" };
  }
  return { destino: `/adm-interno${resto}`, api: false, publica: resto === "/entrar" };
}

// Caminho real da rota de API atendida (depois da reescrita do admin), ou null.
function caminhoDaApi(pathname: string, rotaAdmin: RotaAdmin | null) {
  if (rotaAdmin) return rotaAdmin.api ? rotaAdmin.destino : null;
  return pathname === "/api" || pathname.startsWith("/api/") ? pathname : null;
}

function naoEncontrado(request: NextRequest) {
  return NextResponse.rewrite(new URL(CAMINHO_INEXISTENTE, request.url));
}

function respostaDeErro(status: number, message: string, details: string, headers?: HeadersInit) {
  return NextResponse.json({ message, details }, { status, headers });
}

// Falha aberta: se o banco cair, o site continua respondendo (as rotas de
// login têm o próprio limite, que falha fechado). Sem IP identificado, todos
// dividem a mesma chave: o limite geral não deve barrar o site inteiro.
async function dentroDoLimiteGeral(request: NextRequest) {
  try {
    return await limitar(chaveIp(request, "api") ?? "api:sem-ip", 120, 60, {
      falhaAberta: true,
    });
  } catch {
    return true;
  }
}

// Barra POST de formulário vindo de outro site (CSRF): o navegador sempre
// manda Sec-Fetch-Site e, num POST entre sites, Origin.
function origemConfiavel(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;

  const origem = request.headers.get("origin");
  if (origem === null) return true;

  const host = request.headers.get("host") ?? request.nextUrl.host;
  try {
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}

// Formulário HTML só envia urlencoded, multipart ou text/plain: exigir JSON
// fecha a porta para o POST entre sites mesmo sem os cabeçalhos acima.
function tipoDeCorpoAceito(request: NextRequest, rotaApi: string) {
  const tipo = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!tipo) {
    const tamanho = request.headers.get("content-length");
    return request.headers.get("transfer-encoding") === null && (tamanho === null || tamanho === "0");
  }
  if (tipo === "application/json") return true;
  return tipo === "multipart/form-data" && request.method === "POST" && rotaApi === ROTA_MULTIPART;
}

// Uma página do portal carrega dezenas de fotos de uma vez: contá-las no limite
// geral por IP bloquearia o próprio cliente. Essas rotas já têm limite por usuário,
// então a isenção vale só para quem tem sessão.
const ROTA_DE_FOTO_DO_PORTAL = /^\/api\/portal\/(?:atualizacao|relato)-fotos\/[^/]+$/;

function isentaDoLimiteGeral(request: NextRequest, rotaApi: string, autenticado: boolean) {
  return autenticado && request.method === "GET" && ROTA_DE_FOTO_DO_PORTAL.test(rotaApi);
}

async function bloqueioDaApi(request: NextRequest, rotaApi: string, autenticado: boolean) {
  if (!isentaDoLimiteGeral(request, rotaApi, autenticado) && !(await dentroDoLimiteGeral(request))) {
    return respostaDeErro(429, "TooManyRequestsError", "Muitas requisições. Tente novamente em instantes.", {
      "Retry-After": "60",
    });
  }
  if (METODOS_SEGUROS.includes(request.method)) return null;

  if (!origemConfiavel(request)) {
    return respostaDeErro(403, "ForbiddenError", "Acesso negado.");
  }
  if (!tipoDeCorpoAceito(request, rotaApi)) {
    return respostaDeErro(415, "UnsupportedMediaTypeError", "Formato de envio não aceito.");
  }
  return null;
}

// Renova a sessão do Supabase a cada requisição.
// No Next.js 16 este arquivo substitui o antigo middleware.ts.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (acessaRotaInternaDoAdmin(pathname)) return naoEncontrado(request);

  const adminPath = obterAdminPath();
  const rotaAdmin = adminPath ? reescreverRotaDoAdmin(pathname, adminPath) : null;

  const criarResposta = () => {
    if (!rotaAdmin) return NextResponse.next({ request });

    const destino = request.nextUrl.clone();
    destino.pathname = rotaAdmin.destino;
    return NextResponse.rewrite(destino, { request });
  };

  let response = criarResposta();
  let autenticado = false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Sem as envs do Supabase (.env ainda não configurado), não há sessão
  // pra renovar — deixa a página seguir normalmente em vez de quebrar o
  // site inteiro. Isso é o cenário mais comum logo após copiar o template.
  if (supabaseUrl && supabasePublishableKey) {
    const supabase = createServerClient(
      supabaseUrl,
      supabasePublishableKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(
            cookiesToSet: {
              name: string;
              value: string;
              options: CookieOptions;
            }[]
          ) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            response = criarResposta();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // Importante: isso atualiza o token de sessão se estiver expirado.
    const { data } = await supabase.auth.getClaims();
    autenticado = Boolean(data?.claims);
  }

  // Sem sessão, o caminho secreto responde exatamente como qualquer URL
  // desconhecida: mesmo 404, sem cabeçalho, título ou limite diferente. A
  // checagem de papel continua nos layouts e em cada rota.
  if (rotaAdmin && !rotaAdmin.publica && !autenticado) return naoEncontrado(request);

  const rotaApi = caminhoDaApi(pathname, rotaAdmin);
  const apiPortal = rotaApi !== null && /^\/api\/(?:adm-interno\/)?portal(?:\/|$)/.test(rotaApi);
  const protegerPortal = (resposta: NextResponse) => {
    resposta.headers.set("Cache-Control", "private, no-store");
    resposta.headers.set("Referrer-Policy", "no-referrer");
    return resposta;
  };
  if (rotaApi) {
    const bloqueio = await bloqueioDaApi(request, rotaApi, autenticado);
    if (bloqueio) return apiPortal ? protegerPortal(bloqueio) : bloqueio;
  }

  if (apiPortal || (rotaAdmin && /^\/adm-interno\/portal(?:\/|$)/.test(rotaAdmin.destino))) {
    protegerPortal(response);
  }

  if (AREA_SEM_CACHE.test(pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/adm-interno/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
