import type { Campo } from "./Formulario";

export const SITUACOES_EMPREENDIMENTO = [
  { valor: "ativo", nome: "Ativo" },
  { valor: "concluido", nome: "Concluído" },
  { valor: "arquivado", nome: "Arquivado (cliente continua com acesso)" },
];

export function camposEmpreendimento(loteamentos: { valor: string; nome: string }[]): Campo[] {
  return [
    { nome: "nome", rotulo: "Nome" },
    { nome: "cidade", rotulo: "Cidade", nullable: true },
    { nome: "descricao", rotulo: "Descrição", tipo: "longo", nullable: true },
    { nome: "situacao", rotulo: "Situação", tipo: "select", opcoes: SITUACOES_EMPREENDIMENTO },
    { nome: "loteamentoId", rotulo: "Loteamento (opcional)", tipo: "select", nullable: true, opcoes: loteamentos },
  ];
}

export const INICIAIS_EMPREENDIMENTO = { nome: "", cidade: null, descricao: null, situacao: "ativo", loteamentoId: null };
