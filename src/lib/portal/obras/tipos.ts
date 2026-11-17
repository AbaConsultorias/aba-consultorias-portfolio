import type { DataCivil, UUID } from "../comum/tipos";
import type { FotoPortal } from "../andamento/tipos";

export type SituacaoObra = "planejada" | "em_andamento" | "concluida";
export type StatusRelato = "pendente" | "aprovado" | "devolvido";
export type ObraEmpreiteiro = {
  id: UUID; nome: string; empreendimentoNome: string | null;
  previstoInicio: DataCivil | null; previstoFim: DataCivil | null;
  situacao: SituacaoObra; percentual: number; relatosPendentes: number;
};
export type EmpreiteiroDaObra = { vinculoId: UUID; profileId: UUID; nome: string; ativo: boolean };
export type ObraAdmin = ObraEmpreiteiro & { empreendimentoId: UUID; empreiteiros: EmpreiteiroDaObra[] };
export type RelatoObra = {
  id: UUID; obraId: UUID; texto: string; percentualInformado: number | null;
  situacaoInformada: SituacaoObra | null; status: StatusRelato;
  motivoDevolucao: string | null; criadoEm: string; revisadoEm: string | null; fotos: FotoPortal[];
};
export type RelatoFila = RelatoObra & {
  obraNome: string; empreendimentoNome: string | null; autorNome: string | null;
  percentualAtual: number; situacaoAtual: SituacaoObra;
};
