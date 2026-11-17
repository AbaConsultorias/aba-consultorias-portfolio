import { CalendarClock, CircleCheck, CircleDashed, CircleDollarSign, Hourglass, TriangleAlert } from "lucide-react";
import { DIAS_VENCE_EM_BREVE, formatarDataCivil, situacaoVisualParcela, type SituacaoItem, type SituacaoVisualParcela } from "@/lib/portal/financeiro/regras";
import type { ParcelaPortal } from "@/lib/portal/financeiro/tipos";

const situacoes = {
  quitada: { Icone: CircleCheck, texto: "Quitada" },
  vencida: { Icone: TriangleAlert, texto: "Vencida" },
  parcial: { Icone: CircleDollarSign, texto: "Pago parcialmente" },
  "vence-em-breve": { Icone: CalendarClock, texto: `Vence em até ${DIAS_VENCE_EM_BREVE} dias` },
  aberta: { Icone: CircleDashed, texto: "Em aberto" },
  "aguarda-evento": { Icone: Hourglass, texto: "Aguarda evento" },
  quitado: { Icone: CircleCheck, texto: "Quitado" },
  atraso: { Icone: TriangleAlert, texto: "Com parcela vencida" },
  "em-dia": { Icone: CircleDashed, texto: "Em aberto" },
};

export function SeloSituacaoFinanceira({ situacao, texto }: {
  situacao: SituacaoVisualParcela | SituacaoItem;
  texto?: string;
}) {
  const { Icone, texto: rotulo } = situacoes[situacao];
  return (
    <span className="fin-situacao" data-estado={situacao}>
      <Icone size={14} aria-hidden="true" />
      {texto ?? rotulo}
    </span>
  );
}

// `rotuloEvento` é o texto do gatilho ("Aguarda aprovação do SAA"); sem ele, o selo da parcela que aguarda diz "Aguarda evento".
export function SeloParcela({ parcela, hoje, rotuloEvento }: { parcela: ParcelaPortal; hoje: string; rotuloEvento?: string }) {
  const situacao = situacaoVisualParcela(parcela, hoje);
  const texto = parcela.dataPagamento ? `Quitada em ${formatarDataCivil(parcela.dataPagamento)}` : situacao === "aguarda-evento" ? rotuloEvento : undefined;
  return <SeloSituacaoFinanceira situacao={situacao} texto={texto} />;
}
