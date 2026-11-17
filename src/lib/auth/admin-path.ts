// Segmento secreto do painel admin. Valor ausente ou com formato
// inesperado (barra, ponto, vazio) conta como "não configurado": o painel
// fica inalcançável em vez de aberto num caminho imprevisto.
export function obterAdminPath(): string | null {
  const valor = process.env.ADMIN_PATH;

  if (!valor || !/^[A-Za-z0-9_-]+$/.test(valor)) {
    return null;
  }

  return valor;
}
