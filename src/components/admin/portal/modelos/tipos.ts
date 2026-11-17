import type { MarcoDeEtapa } from "@/app/api/(modules)/adm-interno/portal/modelos/schema";

export type EtapaDoModelo = { id?: string; nome: string; ordem: number; marco: MarcoDeEtapa | null };
export type CategoriaDoModelo = { id?: string; nome: string; ordem: number };
export type Modelo = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  etapas: EtapaDoModelo[];
  categorias: CategoriaDoModelo[];
};

// Cor do selo de cada marca: confecção em andamento (aviso), análise na Copasa (info), aprovado (ok).
export const TOM_DO_MARCO: Record<MarcoDeEtapa, "aviso" | "info" | "ok"> = { confeccao: "aviso", analise: "info", aprovado: "ok" };

export const porOrdem = <T extends { ordem: number }>(itens: T[]) => [...itens].sort((a, b) => a.ordem - b.ordem);
