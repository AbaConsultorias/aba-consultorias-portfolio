import { formatarDataCivil, parcelaQuitada, rotuloGatilho, rotuloRegra } from "@/lib/portal/financeiro/regras";
import type { ParcelaPortal } from "@/lib/portal/financeiro/tipos";

// Data do vencimento (com a regra que a definiu, em texto menor) ou, enquanto o evento não acontece, o que a parcela aguarda.
export function VencimentoParcela({ parcela, nomeProjeto }: { parcela: ParcelaPortal; nomeProjeto: string | null }) {
  if (parcela.vencimento === null) {
    return parcelaQuitada(parcela) ? <>—</> : <span className="fin-gatilho">{rotuloGatilho(parcela, nomeProjeto)}</span>;
  }
  const regra = rotuloRegra(parcela, nomeProjeto);
  return (
    <>
      {formatarDataCivil(parcela.vencimento)}
      {regra && <small className="fin-regra">{regra}</small>}
    </>
  );
}
