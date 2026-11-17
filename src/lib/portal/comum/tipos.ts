export type UUID = string;
export type DataCivil = string;
export type Centavos = string;
export type Pagina<T> = { registros: T[]; proximaPagina: number | null };
export type ConsultaPagina = { pagina?: number; limite?: number };

export type EmpreendimentoResumo = {
  id: UUID;
  nome: string;
  cidade: string | null;
  situacao: "ativo" | "concluido" | "arquivado";
};
