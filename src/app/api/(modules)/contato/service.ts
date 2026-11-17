import "server-only";
import { after } from "next/server";
import { BadRequestError, InternalServerError, TooManyRequestsError } from "../../HttpErrors";
import { chaveIp, limitar } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { avisarContato } from "./aviso";
import type { ContatoInput } from "./schema";

async function validarInteresse(dados: ContatoInput) {
  if (!dados.loteamentoId && !dados.loteId) return;
  const supabase = await createClient();
  let loteamentoId = dados.loteamentoId;
  if (dados.loteId) {
    const { data, error } = await supabase.from("lotes").select("loteamento_id").eq("id", dados.loteId).maybeSingle<{ loteamento_id: string }>();
    if (error) throw new InternalServerError(null);
    if (!data || (loteamentoId && data.loteamento_id !== loteamentoId)) throw new BadRequestError("Não foi possível enviar a mensagem. Confira seu interesse e tente novamente.");
    loteamentoId = data.loteamento_id;
  }
  const { data, error } = await supabase.from("loteamentos").select("id").eq("id", loteamentoId!).eq("publicado", true).maybeSingle();
  if (error) throw new InternalServerError(null);
  if (!data) throw new BadRequestError("Não foi possível enviar a mensagem. Confira seu interesse e tente novamente.");
  return loteamentoId;
}

const LIMITE_ATINGIDO = "Não foi possível enviar agora. Tente novamente mais tarde.";

// Por IP primeiro, para quem já foi barrado não gastar o teto global; o teto
// global segura quem troca de IP a cada envio.
async function exigirLimitePorIp(ipHash: string | null) {
  if (!(await limitar(ipHash, 5, 10 * 60))) throw new TooManyRequestsError(LIMITE_ATINGIDO);
}

async function exigirLimiteGlobal() {
  if (!(await limitar("contato:global", 100, 60 * 60))) throw new TooManyRequestsError(LIMITE_ATINGIDO);
}

export async function enviarContato(dados: ContatoInput, request: Request) {
  const ipHash = chaveIp(request, "contato");
  await exigirLimitePorIp(ipHash);
  // Robô que preenche o honeypot não gasta a cota global dos envios reais.
  if (dados.site) return;
  await exigirLimiteGlobal();
  const loteamentoId = await validarInteresse(dados);
  const { error } = await createAdminClient().from("contatos").insert({
    nome: dados.nome,
    telefone: dados.telefone || null,
    email: dados.email || null,
    mensagem: dados.mensagem,
    origem: dados.origem,
    loteamento_id: loteamentoId ?? null,
    lote_id: dados.loteId ?? null,
    ip_hash: ipHash,
  });
  if (error) throw new InternalServerError(null);
  after(() => avisarContato(dados, loteamentoId));
}
