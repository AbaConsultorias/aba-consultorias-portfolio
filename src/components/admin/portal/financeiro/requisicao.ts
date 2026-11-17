import type { RespostaApi } from "@/components/admin/comum/cliente-api";

type Recurso = "itens-financeiros" | "parcelas" | "contratos" | "financeiro-eventos";

function primeiroTexto(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (typeof valor !== "object" || valor === null) return null;
  for (const filho of Object.values(valor)) {
    const texto = primeiroTexto(filho);
    if (texto) return texto;
  }
  return null;
}

export async function chamarPortal(
  adminPath: string,
  recurso: Recurso,
  metodo: "POST" | "PATCH" | "DELETE",
  corpo: unknown,
): Promise<RespostaApi> {
  try {
    const res = await fetch(`/${adminPath}/api/portal/${recurso}`, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const json: unknown = await res.json().catch(() => null);
    const details = typeof json === "object" && json !== null && "details" in json ? json.details : null;
    if (res.ok) return { ok: true, details, erro: null, erros: {} };
    const erros: Record<string, string> = {};
    if (typeof details === "object" && details !== null) {
      for (const [campo, valor] of Object.entries(details)) {
        const texto = primeiroTexto(valor);
        if (texto) erros[campo] = texto;
      }
    }
    return { ok: false, details: null, erro: primeiroTexto(details) ?? "Não foi possível concluir. Tente novamente.", erros };
  } catch {
    return { ok: false, details: null, erro: "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.", erros: {} };
  }
}
