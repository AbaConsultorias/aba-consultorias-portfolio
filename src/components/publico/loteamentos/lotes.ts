import type { Lote, StatusLote } from "@/lib/conteudo/tipos";

export const ROTULO_STATUS: Record<StatusLote, string> = {
  disponivel: "Disponível",
  vendido: "Vendido",
  area_tecnica: "Área técnica",
};

export const ESTILO_STATUS: Record<StatusLote, { badge: string; ponto: string }> = {
  disponivel: { badge: "bg-emerald-50 text-emerald-800 ring-emerald-700/20", ponto: "bg-emerald-600" },
  vendido: { badge: "bg-red-50 text-red-800 ring-red-700/20", ponto: "bg-red-600" },
  area_tecnica: { badge: "bg-slate-100 text-slate-700 ring-slate-500/25", ponto: "bg-slate-500" },
};

export function identificarLote(lote: Pick<Lote, "quadra" | "numero">) {
  return `Quadra ${lote.quadra}, lote ${lote.numero}`;
}

export function formatarArea(areaM2: number | null) {
  if (areaM2 === null) return "—";
  return `${areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`;
}

export function hrefInteresse(slug: string, lote: Pick<Lote, "quadra" | "numero">) {
  const params = new URLSearchParams({ loteamento: slug, lote: `${lote.quadra}-${lote.numero}` });
  return `/contato?${params.toString()}`;
}

export function mensagemWhatsAppLote(nomeLoteamento: string, lote: Pick<Lote, "quadra" | "numero">) {
  return `Olá! Tenho interesse no lote ${lote.numero} da quadra ${lote.quadra} do loteamento ${nomeLoteamento}.`;
}
