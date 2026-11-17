import type { ItemFornecedor } from "./tipos";

export const TIPOS_DOCUMENTO = ["nota_fiscal", "certidao", "comprovante", "proposta", "outro"] as const;
export const MIMES_FORNECEDOR = ["application/pdf", "image/jpeg", "image/png"] as const;
export const LIMITE_ARQUIVO_FORNECEDOR = 20971520;
export const ROTULOS_DOCUMENTO = { nota_fiscal: "Nota fiscal", certidao: "Certidão", comprovante: "Comprovante", proposta: "Proposta", outro: "Outro" } as const;

export function normalizarCnpj(texto: string): string | null {
  const valor = texto.trim();
  if (!/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(valor)) return null;
  const digitos = valor.replace(/\D/g, "");
  if (/^(\d)\1{13}$/.test(digitos)) return null;
  for (const tamanho of [12, 13]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(digitos[i]) * ((tamanho - i - 1) % 8 + 2);
    const resto = soma % 11;
    if (Number(digitos[tamanho]) !== (resto < 2 ? 0 : 11 - resto)) return null;
  }
  return digitos;
}

export function formatarCnpj(cnpj: string | null): string {
  return cnpj ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "Não informado";
}

export function agruparPorEmpreendimento(itens: readonly ItemFornecedor[]) {
  const grupos = new Map<string, { empreendimentoId: string; empreendimentoNome: string | null; itens: ItemFornecedor[] }>();
  for (const item of itens) {
    const grupo = grupos.get(item.empreendimentoId) ?? { empreendimentoId: item.empreendimentoId, empreendimentoNome: item.empreendimentoNome, itens: [] };
    grupo.itens.push(item);
    grupos.set(item.empreendimentoId, grupo);
  }
  return [...grupos.values()].sort((a, b) => (a.empreendimentoNome ?? "").localeCompare(b.empreendimentoNome ?? "", "pt-BR") || a.empreendimentoId.localeCompare(b.empreendimentoId));
}
