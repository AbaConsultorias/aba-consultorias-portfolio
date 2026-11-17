import type { StatusLote } from "@/lib/conteudo/tipos";

export const ORDEM_STATUS: StatusLote[] = ["disponivel", "vendido", "area_tecnica"];

export const ROTULO_STATUS: Record<StatusLote, string> = {
  disponivel: "Disponível",
  vendido: "Vendido",
  area_tecnica: "Área técnica",
};

// Cor do botão de status marcado (texto sempre com contraste AA sobre o fundo).
export const CLASSE_STATUS_ATIVO: Record<StatusLote, string> = {
  disponivel: "border-emerald-700 bg-emerald-700 text-white",
  vendido: "border-red-700 bg-red-700 text-white",
  area_tecnica: "border-slate-600 bg-slate-600 text-white",
};

export const COR_NO_MAPA: Record<StatusLote, string> = {
  disponivel: "#2f8f5b",
  vendido: "#b42318",
  area_tecnica: "#8a8f98",
};

export function formatarArea(area: number | null) {
  return area === null ? "—" : `${area.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`;
}
