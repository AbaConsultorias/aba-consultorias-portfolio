import type { Centavos, DataCivil, UUID } from "../comum/tipos";

export const TIPOS_EVENTO = [
  "assinatura", "protocolo", "aprovacao", "entrega", "doacoes_protocolo", "doacoes_liberacao",
  "tro_pedido", "tro_liberacao", "urbanistico_aprovacao", "outro",
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];
export type GatilhoParcela = "data" | "evento";
export type OrigemEvento = "etapas" | "botao" | "contrato" | "protocolo";

export type ParcelaPortal = {
  id: UUID;
  itemId: UUID;
  numero: number | null;
  nome: string | null;
  vencimento: DataCivil | null;
  valorPrevistoCentavos: Centavos;
  valorPagoCentavos: Centavos;
  dataPagamento: DataCivil | null;
  gatilho: GatilhoParcela;
  eventoTipo: TipoEvento | null;
  eventoProjetoId: UUID | null;
  eventoDescricao: string | null;
  diasApos: number;
  eventoId: UUID | null;
};

export type ParcelaComVencimento = ParcelaPortal & { vencimento: DataCivil };

export type ProjetoDoContrato = { id: UUID; nome: string };

export type ItemFinanceiroPortal = {
  id: UUID;
  descricao: string;
  fornecedorId: UUID | null;
  fornecedorNome: string | null;
  observacao: string | null;
  valorContratadoCentavos: Centavos;
  codigo: string | null;
  versao: number | null;
  assinadoEm: DataCivil | null;
  documentoId: UUID | null;
  atualizadoEm: string;
  projetos: ProjetoDoContrato[];
  parcelas: ParcelaPortal[];
};

export type ResumoFinanceiro = {
  contratadoCentavos: Centavos;
  pagoCentavos: Centavos;
  saldoCentavos: Centavos;
  proximoPagamento: ParcelaComVencimento | null;
};

export type EventoFinanceiro = {
  id: UUID;
  tipo: TipoEvento;
  projetoId: UUID | null;
  itemId: UUID | null;
  parcelaId: UUID | null;
  ocorridoEm: DataCivil;
  origem: OrigemEvento;
  criadoPorNome: string | null;
  desfeitoEm: string | null;
};

export type ParcelaACobrar = {
  parcelaId: UUID;
  itemId: UUID;
  empreendimentoId: UUID;
  empreendimentoNome: string | null;
  codigo: string | null;
  versao: number | null;
  descricao: string;
  nome: string | null;
  numero: number | null;
  totalParcelas: number;
  vencimento: DataCivil;
  saldoCentavos: Centavos;
  vencida: boolean;
};

export type DocumentoDoContrato = { id: UUID; titulo: string };

// Em que ponto cada projeto está nas etapas de marco: "emAnalise" vale da etapa de análise em diante.
export type MarcosDoProjeto = { projetoId: UUID; emAnalise: boolean; aprovado: boolean };
