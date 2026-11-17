import type { TipoEvento } from "@/lib/portal/financeiro/tipos";

export const ROTULO_EVENTO: Record<TipoEvento, string> = {
  assinatura: "Assinatura do contrato",
  protocolo: "Protocolo do projeto",
  aprovacao: "Aprovação do projeto",
  entrega: "Entrega",
  doacoes_protocolo: "Protocolo das doações",
  doacoes_liberacao: "Liberação das doações",
  tro_pedido: "Pedido do TRO",
  tro_liberacao: "Liberação do TRO",
  urbanistico_aprovacao: "Aprovação do urbanístico",
  outro: "Outro evento",
};

export const ROTULO_ORIGEM = {
  etapas: "Etapas do projeto",
  botao: "Marcado à mão",
  contrato: "Data do contrato",
  protocolo: "Protocolo do projeto",
} as const;

export function eventoPedeProjeto(tipo: TipoEvento): boolean {
  return tipo === "protocolo" || tipo === "aprovacao" || tipo === "entrega";
}
