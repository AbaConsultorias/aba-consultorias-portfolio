import { PERMISSOES, type Permissao } from "@/lib/auth/permissoes";

export const PERMISSOES_PORTAL: readonly Permissao[] = PERMISSOES.filter((permissao) => !permissao.startsWith("site.") && !permissao.startsWith("contatos."));

// Segmento da rota em portal/ → permissão que mostra o item no menu e o atalho na visão geral.
export const PERMISSAO_POR_SEGMENTO = {
  empreendimentos: "empreendimentos.ver",
  clientes: "clientes.ver",
  modelos: "empreendimentos.ver",
  atualizacoes: "atualizacoes.ver",
  documentos: "documentos.ver",
  chegaram: "documentos.liberar",
  servidor: "painel.servidor",
  financeiro: "financeiro.ver",
  obras: "obras.ver",
  relatos: "obras.ver",
  empreiteiros: "obras.ver",
  fornecedores: "fornecedores.ver",
  "fornecedor-documentos": "fornecedores.ver",
  cronograma: "financeiro.ver",
  "a-cobrar": "financeiro.ver",
} as const satisfies Record<string, Permissao>;

export function temAcessoAoPortal(permissoes: ReadonlySet<Permissao>): boolean {
  return PERMISSOES_PORTAL.some((permissao) => permissoes.has(permissao));
}
