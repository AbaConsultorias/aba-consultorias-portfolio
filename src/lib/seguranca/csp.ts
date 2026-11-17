type OpcoesCsp = {
  supabaseUrl?: string;
  r2AccountId?: string;
  producao: boolean;
};

// O envio de PDF vai direto do navegador ao R2; id ausente ou fora do formato (32 hex) não libera origem alguma.
function origemDoR2(accountId: string | undefined) {
  return accountId && /^[0-9a-f]{32}$/.test(accountId) ? `https://${accountId}.r2.cloudflarestorage.com` : null;
}

// Só a origem (esquema + host + porta) entra na política: o caminho de
// NEXT_PUBLIC_SUPABASE_URL não importa e uma URL inválida não pode derrubar o
// build, então vira "sem origem extra" e o Storage fica bloqueado de propósito.
function origemDoSupabase(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null;
  try {
    const { origin } = new URL(supabaseUrl);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

// CSP estática (sem nonce): as páginas públicas são ISR e um nonce por
// requisição as tornaria dinâmicas. Por isso script-src e style-src carregam
// 'unsafe-inline' — o Next injeta scripts inline na hidratação.
export function montarCsp({ supabaseUrl, r2AccountId, producao }: OpcoesCsp) {
  const supabase = origemDoSupabase(supabaseUrl);
  const r2 = origemDoR2(r2AccountId);
  const comSupabase = (...fontes: string[]) => (supabase ? [...fontes, supabase] : fontes).join(" ");

  const diretivas = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${producao ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${comSupabase("'self'", "data:", "blob:")}`,
    `media-src ${comSupabase("'self'", "blob:")}`,
    "font-src 'self'",
    // O envio direto ao Storage por URL assinada (fetch PUT) e o mapa SVG dos
    // lotes (fetch do arquivo público) saem do navegador para o Supabase; o PUT
    // de PDF de cliente vai ao R2. Em desenvolvimento o HMR do Next usa WebSocket.
    `connect-src ${[comSupabase("'self'", ...(producao ? [] : ["ws:", "wss:"])), ...(r2 ? [r2] : [])].join(" ")}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (producao) diretivas.push("upgrade-insecure-requests");

  return diretivas.join("; ");
}
