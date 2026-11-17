import z from "zod";
import { ErroDeConexao, MENSAGEM_FALHA_NO_SERVIDOR, buscar, mensagemDaFalha } from "@/components/portal/comum/falhas";

export class ErroRequisicao extends Error {
  constructor(mensagem: string, public status: number) { super(mensagem); }
}
export async function requisicao<T>(endpoint: string, metodo: "POST" | "PATCH" | "DELETE", entrada: unknown, schema: z.ZodType<T>): Promise<T> {
  const resposta = await buscar(endpoint, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(entrada), cache: "no-store", redirect: "error" })
    // Status 0: a requisição nem chegou ao servidor, então o estado da tela continua valendo para nova tentativa.
    .catch((erro: unknown) => { throw erro instanceof ErroDeConexao ? new ErroRequisicao(erro.message, 0) : erro; });
  // Resposta fora do JSON (ex.: página de erro) vira mensagem legível, não "Unexpected token".
  const json: unknown = await resposta.json().catch(() => { throw new ErroRequisicao(resposta.status >= 500 ? MENSAGEM_FALHA_NO_SERVIDOR : "Não foi possível falar com o servidor. Tente novamente.", resposta.status); });
  const resultado = z.object({ details: z.unknown().optional() }).parse(json);
  if (!resposta.ok) throw new ErroRequisicao(mensagemDaFalha(resultado.details, resposta.status), resposta.status);
  return schema.parse(resultado.details);
}
