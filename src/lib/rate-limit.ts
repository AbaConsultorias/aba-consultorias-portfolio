import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type OpcoesLimite = {
  // Se a RPC falhar: false (padrão) nega; true deixa passar. Só o limite
  // geral do proxy usa true — uma queda do banco não pode derrubar o site.
  falhaAberta?: boolean;
};

// true = permitido, false = bloqueado. Chave null (IP não identificado)
// sempre bloqueia: sem IP não há como separar quem tenta de quem não tenta.
export async function limitar(
  chave: string | null,
  limite: number,
  janelaSegundos: number,
  { falhaAberta = false }: OpcoesLimite = {},
) {
  if (chave === null) return false;

  try {
    const { data, error } = await createAdminClient().rpc("verificar_rate_limit", {
      p_chave: chave,
      p_limite: limite,
      p_janela_segundos: janelaSegundos,
    });

    if (error) {
      console.error("[rate-limit] erro na RPC:", error.code);
      return falhaAberta;
    }

    return data === true;
  } catch {
    console.error("[rate-limit] não foi possível chamar a RPC.");
    return falhaAberta;
  }
}

// Esses headers só são confiáveis atrás da Vercel (ou outro proxy confiável),
// que sobrescreve o valor enviado pelo cliente; fora dela dá para forjá-los.
function ipDe(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

function contarGrupos(grupos: string[]) {
  return grupos.reduce((total, grupo) => total + (grupo.includes(".") ? 2 : 1), 0);
}

// Um provedor entrega um /64 inteiro a cada cliente IPv6: limitar por endereço
// deixaria quem ataca trocar de IP à vontade. IPv4 (inclusive ::ffff:a.b.c.d)
// segue inteiro. Endereço malformado volta como veio.
function redeDoIp(ip: string) {
  const endereco = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!endereco.includes(":")) return endereco;

  const ipv4Mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(endereco);
  if (ipv4Mapeado) return ipv4Mapeado[1];

  const partes = endereco.split("::");
  if (partes.length > 2) return endereco;

  const esquerda = partes[0] ? partes[0].split(":") : [];
  const direita = partes[1] ? partes[1].split(":") : [];
  const zeros = partes.length === 2 ? 8 - contarGrupos(esquerda) - contarGrupos(direita) : 0;
  if (zeros < 0) return endereco;

  const grupos = [...esquerda, ...Array<string>(zeros).fill("0"), ...direita].slice(0, 4);
  if (grupos.length < 4 || !grupos.every((grupo) => /^[0-9a-f]{1,4}$/.test(grupo))) return endereco;

  return `${grupos.map((grupo) => Number.parseInt(grupo, 16).toString(16)).join(":")}::/64`;
}

function lerSal() {
  const sal = process.env.RATE_LIMIT_SALT;
  if (!sal) {
    throw new Error("RATE_LIMIT_SALT ausente.");
  }
  return sal;
}

// Teto por conta, sem IP: segura quem troca de IP a cada tentativa. O
// identificador entra no banco só como hash com sal, como em chaveIp.
export function chaveConta(prefixo: string, identificador: string) {
  const entrada = `${identificador.toLowerCase()}${lerSal()}`;
  return `${prefixo}:${createHash("sha256").update(entrada).digest("hex")}`;
}

// O IP (e o identificador, se houver) só entra no banco como hash com sal,
// para a tabela rate_limits não guardar e-mail nem IP em claro. Devolve null
// quando o IP não pôde ser determinado.
export function chaveIp(request: Request, prefixo: string, complemento?: string) {
  const sal = lerSal();

  const endereco = ipDe(request);
  if (!endereco) return null;
  const ip = redeDoIp(endereco);

  const entrada = complemento
    ? `${ip}|${complemento.toLowerCase()}${sal}`
    : `${ip}${sal}`;

  return `${prefixo}:${createHash("sha256").update(entrada).digest("hex")}`;
}
