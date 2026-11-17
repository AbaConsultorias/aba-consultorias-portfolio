"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { formatarBRL, nomeParcela, numeroDaParcela, percentualDoContratado, situacaoVisualParcela } from "@/lib/portal/financeiro/regras";
import type { ParcelaPortal } from "@/lib/portal/financeiro/tipos";
import { SeloParcela } from "@/components/portal/financeiro/SeloSituacaoFinanceira";
import { VencimentoParcela } from "@/components/portal/financeiro/VencimentoParcela";
import { FormularioParcela } from "./FormulariosFinanceiro";
import { chamarPortal } from "./requisicao";

// Parcela de contrato da ABA: a estrutura (nome, valor, gatilho, exclusão) muda só no editor do contrato; aqui só o pagamento.
export function LinhaParcela({ adminPath, itemId, contratado, posicao, total, parcela, observacao, nomeProjeto, hoje, somenteLeitura, ehContrato }: {
  adminPath: string;
  itemId: string;
  contratado: string;
  posicao: number;
  total: number;
  parcela: ParcelaPortal;
  observacao: string | null;
  nomeProjeto: string | null;
  hoje: string;
  somenteLeitura: boolean;
  ehContrato: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const percentual = percentualDoContratado(parcela.valorPrevistoCentavos, contratado);
  return (
    <li className="fin-admin-parcela flex flex-col gap-3" data-estado={situacaoVisualParcela(parcela, hoje)}>
      <div className="fin-admin-linha text-sm">
        <span className="fin-admin-linha-nome">
          <span className="fin-admin-numero">{numeroDaParcela(parcela, posicao, total)}</span>
          <strong>{nomeParcela(parcela, posicao)}</strong>
        </span>
        <span className="fin-admin-linha-venc"><VencimentoParcela parcela={parcela} nomeProjeto={nomeProjeto} /></span>
        <span>previsto {formatarBRL(parcela.valorPrevistoCentavos)}{percentual !== null && ` (${percentual}%)`}</span>
        <span>pago {formatarBRL(parcela.valorPagoCentavos)}</span>
        <SeloParcela parcela={parcela} hoje={hoje} />
      </div>
      {observacao && <p className="fin-observacao">{observacao}</p>}
      {somenteLeitura ? null : editando ? (
        <FormularioParcela
          adminPath={adminPath} itemId={itemId} contratado={contratado} posicao={posicao} parcela={parcela} observacao={observacao}
          somentePagamento={parcela.gatilho === "evento"} ehContrato={ehContrato} aoFechar={() => setEditando(false)}
        />
      ) : (
        <div className="fin-admin-acoes">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)}>
            <Pencil aria-hidden="true" />{ehContrato ? "Registrar pagamento" : "Editar / registrar pagamento"}
          </Button>
          {!ehContrato && (
            <ConfirmarExclusao
              rotulo="Excluir parcela"
              aviso="Excluir esta parcela? Parcelas com pagamento registrado não podem ser excluídas."
              aoConfirmar={async () => {
                const resposta = await chamarPortal(adminPath, "parcelas", "DELETE", { id: parcela.id });
                if (resposta.ok) router.refresh();
                return resposta.ok ? null : resposta.erro;
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}
