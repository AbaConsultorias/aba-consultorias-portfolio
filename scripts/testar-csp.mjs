// Confere a política de segurança de conteúdo (src/lib/seguranca/csp.ts).
// Uso: node scripts/testar-csp.mjs (Node 22.18+ ou 23.6+, que importam .ts
// removendo os tipos). Sai com código 1 se algo falhar.
import { exit } from "node:process";
import { montarCsp } from "../src/lib/seguranca/csp.ts";

const SUPABASE = "https://abcdefgh.supabase.co";

let falhas = 0;
function falhar(caso, detalhe) {
  falhas += 1;
  console.error(`FALHOU [${caso}]: ${detalhe}`);
}

function diretivas(politica) {
  return new Map(
    politica.split("; ").map((diretiva) => {
      const [nome, ...fontes] = diretiva.split(" ");
      return [nome, fontes];
    }),
  );
}

function exigir(caso, politica, nome, esperado) {
  const fontes = diretivas(politica).get(nome);
  if (!fontes) return falhar(caso, `diretiva ${nome} ausente`);
  if (fontes.join(" ") !== esperado) falhar(caso, `${nome} = "${fontes.join(" ")}", esperado "${esperado}"`);
}

const producao = montarCsp({ supabaseUrl: `${SUPABASE}/rest/v1/`, producao: true });
exigir("produção", producao, "default-src", "'self'");
exigir("produção", producao, "script-src", "'self' 'unsafe-inline'");
exigir("produção", producao, "style-src", "'self' 'unsafe-inline'");
exigir("produção", producao, "img-src", `'self' data: blob: ${SUPABASE}`);
exigir("produção", producao, "media-src", `'self' blob: ${SUPABASE}`);
exigir("produção", producao, "font-src", "'self'");
exigir("produção", producao, "connect-src", `'self' ${SUPABASE}`);
exigir("produção", producao, "frame-src", "'none'");
exigir("produção", producao, "frame-ancestors", "'none'");
exigir("produção", producao, "object-src", "'none'");
exigir("produção", producao, "base-uri", "'self'");
exigir("produção", producao, "form-action", "'self'");
if (!diretivas(producao).has("upgrade-insecure-requests")) falhar("produção", "upgrade-insecure-requests ausente");
if (producao.includes("unsafe-eval")) falhar("produção", "'unsafe-eval' não pode sair em produção");
if (/\bws:|\bwss:/.test(producao)) falhar("produção", "WebSocket só em desenvolvimento");

const desenvolvimento = montarCsp({ supabaseUrl: "http://127.0.0.1:54321", producao: false });
exigir("desenvolvimento", desenvolvimento, "script-src", "'self' 'unsafe-inline' 'unsafe-eval'");
exigir("desenvolvimento", desenvolvimento, "img-src", "'self' data: blob: http://127.0.0.1:54321");
exigir("desenvolvimento", desenvolvimento, "connect-src", "'self' ws: wss: http://127.0.0.1:54321");
if (diretivas(desenvolvimento).has("upgrade-insecure-requests")) {
  falhar("desenvolvimento", "upgrade-insecure-requests quebraria o Supabase local em http");
}

for (const [caso, supabaseUrl] of Object.entries({ ausente: undefined, vazia: "", inválida: "isto não é uma URL" })) {
  const politica = montarCsp({ supabaseUrl, producao: true });
  exigir(caso, politica, "img-src", "'self' data: blob:");
  exigir(caso, politica, "connect-src", "'self'");
  if (politica.includes("undefined") || politica.includes("null")) falhar(caso, "política com lixo de valor ausente");
}

const CONTA_R2 = "0123456789abcdef0123456789abcdef";
const R2 = `https://${CONTA_R2}.r2.cloudflarestorage.com`;
const comR2 = montarCsp({ supabaseUrl: SUPABASE, r2AccountId: CONTA_R2, producao: true });
exigir("com R2", comR2, "connect-src", `'self' ${SUPABASE} ${R2}`);
exigir("com R2", comR2, "img-src", `'self' data: blob: ${SUPABASE}`);
const comR2Dev = montarCsp({ supabaseUrl: "http://127.0.0.1:54321", r2AccountId: CONTA_R2, producao: false });
exigir("com R2 em desenvolvimento", comR2Dev, "connect-src", `'self' ws: wss: http://127.0.0.1:54321 ${R2}`);
exigir("R2 sem Supabase", montarCsp({ r2AccountId: CONTA_R2, producao: true }), "connect-src", `'self' ${R2}`);
for (const [caso, r2AccountId] of Object.entries({
  ausente: undefined,
  vazia: "",
  curta: "0123456789abcdef",
  maiúscula: CONTA_R2.toUpperCase(),
  "com host extra": `${CONTA_R2}.evil.example`,
  "com caractere fora do hex": `${CONTA_R2.slice(0, 31)}g`,
})) {
  const politica = montarCsp({ supabaseUrl: SUPABASE, r2AccountId, producao: true });
  exigir(`R2 ${caso}`, politica, "connect-src", `'self' ${SUPABASE}`);
  if (politica.includes("r2.cloudflarestorage.com") || politica.includes("undefined")) falhar(`R2 ${caso}`, "origem do R2 indevida na política");
}
if (producao.includes("r2.cloudflarestorage.com")) falhar("produção", "origem do R2 sem R2_ACCOUNT_ID");

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  exit(1);
}
console.log("OK: política de produção e de desenvolvimento conferidas, com e sem a URL do Supabase e o id do R2.");
