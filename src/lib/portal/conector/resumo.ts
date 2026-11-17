export type ErroDoCiclo = { codigoPasta: string | null; mensagem: string };

export type ErrosDoEmpreendimento = {
  chave: string;
  codigoPasta: string | null;
  // null: o código não bate com nenhum empreendimento cadastrado (ou o erro não é de um empreendimento).
  nome: string | null;
  mensagens: string[];
};

// Agrupa por código de pasta, mantendo a ordem em que cada empreendimento aparece pela primeira vez.
export function agruparErrosPorEmpreendimento(
  erros: readonly ErroDoCiclo[],
  nomesPorCodigo: ReadonlyMap<string, string>,
): ErrosDoEmpreendimento[] {
  const grupos = new Map<string, ErrosDoEmpreendimento>();
  for (const erro of erros) {
    const chave = erro.codigoPasta ?? "";
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = { chave: chave || "geral", codigoPasta: erro.codigoPasta, nome: erro.codigoPasta ? (nomesPorCodigo.get(erro.codigoPasta) ?? null) : null, mensagens: [] };
      grupos.set(chave, grupo);
    }
    grupo.mensagens.push(erro.mensagem);
  }
  return [...grupos.values()];
}
