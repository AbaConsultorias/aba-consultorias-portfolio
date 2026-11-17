type Metodo = "POST" | "PUT" | "PATCH";

export type ResultadoEquipe<T> = { ok: true; dados: T } | { ok: false; erro: string };

const ERRO_DE_REDE = "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";
const ERRO_GENERICO = "Não foi possível concluir. Tente novamente.";

function primeiroTexto(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (typeof valor !== "object" || valor === null) return null;
  for (const filho of Object.values(valor)) {
    const texto = primeiroTexto(filho);
    if (texto) return texto;
  }
  return null;
}

function mensagemDe(details: unknown): string {
  const texto = primeiroTexto(details);
  if (!texto) return ERRO_GENERICO;
  return typeof details === "string" ? texto : `Confira os dados informados. ${texto}`;
}

// `caminho` é relativo a /<adminPath>/api/equipe, ex.: "/<id>/permissoes".
export async function chamarEquipe<T>(
  adminPath: string,
  caminho: string,
  metodo: Metodo,
  corpo?: unknown,
): Promise<ResultadoEquipe<T>> {
  try {
    const res = await fetch(`/${adminPath}/api/equipe${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: "no-store",
    });
    const json: unknown = await res.json().catch(() => null);
    const details = typeof json === "object" && json !== null && "details" in json ? json.details : null;
    if (res.ok) return { ok: true, dados: details as T };
    return { ok: false, erro: mensagemDe(details) };
  } catch {
    return { ok: false, erro: ERRO_DE_REDE };
  }
}
