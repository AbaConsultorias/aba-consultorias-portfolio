export const MENSAGEM_SEM_CONEXAO = "Sem conexão com a internet. Seus dados continuam na tela; tente de novo.";
export const MENSAGEM_FALHA_NO_SERVIDOR = "Não foi possível concluir agora. Tente novamente em instantes.";
export const MENSAGEM_CONFERIR_CAMPOS = "Confira os campos informados e tente novamente.";

export class ErroDeConexao extends Error {
  constructor() { super(MENSAGEM_SEM_CONEXAO); }
}

// Cancelamento pedido pela própria tela (AbortSignal) não é falta de internet.
function foiCancelado(erro: unknown) {
  return erro instanceof DOMException && erro.name === "AbortError";
}

export async function buscar(entrada: RequestInfo | URL, opcoes?: RequestInit): Promise<Response> {
  try {
    return await fetch(entrada, opcoes);
  } catch (erro) {
    throw foiCancelado(erro) ? erro : new ErroDeConexao();
  }
}

export function mensagemDaFalha(details: unknown, status: number) {
  if (typeof details === "string") return details;
  return status >= 500 ? MENSAGEM_FALHA_NO_SERVIDOR : MENSAGEM_CONFERIR_CAMPOS;
}
