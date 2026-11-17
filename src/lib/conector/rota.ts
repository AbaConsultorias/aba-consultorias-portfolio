import "server-only";
import { PayloadTooLargeError } from "@/app/api/HttpErrors";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { chaveConta, limitar } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { autenticarConector, type ConectorAutenticado } from "./autenticacao";
import { LIMITE_REQUISICOES_POR_HORA } from "./regras";
import { erroDeLimite, erroInvalido, ErroDoConector, json, semConteudo } from "./resposta";

const JANELA_DE_REQUISICOES_S = 60 * 60;

// Atualização de cortesia: se falhar, o ciclo do programa não deve falhar por causa dela.
async function registrarContato(conectorId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().from("conectores")
      .update({ ultimo_contato_em: new Date().toISOString() }).eq("id", conectorId);
    if (error) console.error("[conector] falha ao registrar o contato:", error.code);
  } catch {
    console.error("[conector] falha ao registrar o contato.");
  }
}

// Casca comum das rotas do conector: chave -> limite de requisições -> contato -> serviço. Qualquer falha de
// autorização é um 404 vazio, igual a uma rota que não existe.
export async function responderAoConector(
  request: Request,
  executar: (conector: ConectorAutenticado) => Promise<Response>,
): Promise<Response> {
  try {
    const conector = await autenticarConector(request.headers.get("authorization"));
    if (!conector) return semConteudo(404);

    if (!await limitar(chaveConta("conector-requisicoes", conector.id), LIMITE_REQUISICOES_POR_HORA, JANELA_DE_REQUISICOES_S)) {
      throw erroDeLimite(JANELA_DE_REQUISICOES_S);
    }
    await registrarContato(conector.id);
    return await executar(conector);
  } catch (error) {
    if (error instanceof ErroDoConector) return error.resposta();
    console.error("[conector] erro inesperado:", error instanceof Error ? error.name : "desconhecido");
    return json({ erro: "interno" }, 500);
  }
}

// Corpo ausente ou que não é JSON vira null (cai na validação do schema).
export async function lerCorpo(request: Request, limiteBytes: number): Promise<unknown> {
  try {
    return await lerJsonLimitado(request, limiteBytes);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw erroInvalido("Corpo grande demais.");
    throw error;
  }
}
