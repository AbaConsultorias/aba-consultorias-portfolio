import type z from "zod";

const SEM_CACHE = { "Cache-Control": "no-store" } as const;

export function json(corpo: unknown, status = 200): Response {
  return Response.json(corpo, { status, headers: SEM_CACHE });
}

export function semConteudo(status: 204 | 404): Response {
  return new Response(null, { status, headers: SEM_CACHE });
}

// Erro que a rota devolve como está (400 e 429 do contrato). Qualquer outro erro vira 500 { erro: "interno" }.
export class ErroDoConector extends Error {
  constructor(public status: 400 | 429, public corpo: { erro: string; [campo: string]: unknown }) {
    super(corpo.erro);
  }

  resposta(): Response {
    return json(this.corpo, this.status);
  }
}

export function erroInvalido(detalhe: string): ErroDoConector {
  return new ErroDoConector(400, { erro: "invalido", detalhe: detalhe.slice(0, 200) });
}

export function erroDeLimite(tentarDepoisS: number): ErroDoConector {
  return new ErroDoConector(429, { erro: "limite", tentar_depois_s: tentarDepoisS });
}

// Texto curto e sem eco do valor recebido: só o campo e a regra violada.
export function detalheDoZod(erro: z.ZodError): string {
  const problema = erro.issues[0];
  if (!problema) return "Corpo inválido.";
  const campo = problema.path.map(String).join(".");
  return campo ? `${campo}: ${problema.message}` : problema.message;
}

export function validarCorpo<T>(schema: z.ZodType<T>, dados: unknown): T {
  const resultado = schema.safeParse(dados);
  if (!resultado.success) throw erroInvalido(detalheDoZod(resultado.error));
  return resultado.data;
}
