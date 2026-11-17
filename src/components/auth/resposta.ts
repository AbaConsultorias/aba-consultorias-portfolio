type RespostaDaApi = { message?: string; details?: unknown };

// Lê o corpo no formato { message, details } das rotas; qualquer coisa
// diferente (HTML de erro, corpo vazio) vira um objeto vazio.
export async function lerResposta(res: Response): Promise<RespostaDaApi> {
  try {
    const json: unknown = await res.json();
    return typeof json === "object" && json !== null ? json : {};
  } catch {
    return {};
  }
}

export const MENSAGEM_SEM_CONEXAO = "Não foi possível conectar. Confira sua internet e tente novamente.";

export function mensagemDeErro(resposta: RespostaDaApi, status?: number) {
  if (typeof resposta.details === "string") return resposta.details;
  if (status !== undefined && status >= 500) return "Erro no servidor. Tente novamente em instantes.";
  return "Verifique os dados enviados e tente novamente.";
}

export function destinoDaResposta(resposta: RespostaDaApi) {
  const details = resposta.details;
  if (typeof details !== "object" || details === null) return null;

  const destino = (details as { destino?: unknown }).destino;
  // Só caminho interno: nunca navega para uma URL vinda de fora.
  return typeof destino === "string" && /^\/(?!\/)/.test(destino) ? destino : null;
}
