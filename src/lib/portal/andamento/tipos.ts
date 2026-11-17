import type { DataCivil, UUID } from "../comum/tipos";
export type EtapaProjeto = { id: UUID; nome: string; ordem: number; concluidaEm: DataCivil | null };
export type ProjetoPortal = { id: UUID; nome: string; ordem: number; projetoPaiId: UUID | null; etapaAtualId: UUID | null; etapas: EtapaProjeto[]; progresso: number };
export type FotoPortal = { id: UUID; mime: string; urlDaRota: string };
export type AtualizacaoPortal = { id: UUID; titulo: string; texto: string | null; dataVisita: DataCivil | null; fotos: FotoPortal[] };
export type ObraPortal = { id: UUID; nome: string; percentual: number; situacao: "planejada" | "em_andamento" | "concluida" };
export type RelatoObraPortal = { id: UUID; obraNome: string; texto: string; criadoEm: string; fotos: FotoPortal[] };
