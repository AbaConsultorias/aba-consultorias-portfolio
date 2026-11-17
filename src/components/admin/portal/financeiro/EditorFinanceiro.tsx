"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { diferencaPrevisto, formatarBRL, situacaoDoItem } from "@/lib/portal/financeiro/regras";
import type { ItemFinanceiroPortal } from "@/lib/portal/financeiro/tipos";
import { ResumoItemFinanceiro } from "@/components/portal/financeiro/ResumoItemFinanceiro";
import "@/components/portal/financeiro/financeiro.css";
import { FormularioItem, FormularioParcela, type FornecedorOpcao } from "./FormulariosFinanceiro";
import { LinhaParcela } from "./LinhaParcela";
import { chamarPortal } from "./requisicao";

type Props = {
  adminPath: string;
  empreendimentoId: string;
  itens: readonly ItemFinanceiroPortal[];
  observacoes: Record<string, string | null>;
  fornecedores: readonly FornecedorOpcao[];
  hoje: string;
  // Sem financeiro.editar a tela mostra valores e parcelas sem formulários nem botões de ação.
  somenteLeitura?: boolean;
};

function CartaoItemAdmin({ adminPath, empreendimentoId, item, observacoes, fornecedores, hoje, somenteLeitura = false }: Omit<Props, "itens"> & { item: ItemFinanceiroPortal }) {
  const router = useRouter();
  const [modo, setModo] = useState<"item" | "parcela" | null>(null);
  const diferenca = diferencaPrevisto(item.valorContratadoCentavos, item.parcelas);
  return (
    <details className="fin-item" data-estado={situacaoDoItem(item, hoje)}>
      <ResumoItemFinanceiro item={item} hoje={hoje} />
      <div className="fin-item-conteudo fin-admin-item">
        {BigInt(diferenca) !== BigInt(0) && (
          <p role="status" className="text-sm text-muted-foreground">
            Conferência: as parcelas previstas somam {formatarBRL((BigInt(item.valorContratadoCentavos) - BigInt(diferenca)).toString())},
            {" "}{BigInt(diferenca) > BigInt(0) ? `${formatarBRL(diferenca)} a menos` : `${formatarBRL((-BigInt(diferenca)).toString())} a mais`} que o valor contratado.
          </p>
        )}
        {item.observacao && <p className="fin-observacao">{item.observacao}</p>}
        {somenteLeitura ? null : modo === "item" ? (
          <FormularioItem adminPath={adminPath} empreendimentoId={empreendimentoId} item={item} fornecedores={fornecedores} aoFechar={() => setModo(null)} />
        ) : (
          <div className="fin-admin-acoes">
            <Button type="button" variant="outline" size="sm" onClick={() => setModo("item")}><Pencil aria-hidden="true" />Editar item</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setModo("parcela")}><Plus aria-hidden="true" />Nova parcela</Button>
            <ConfirmarExclusao
              rotulo="Excluir item"
              aviso="Excluir o item e todas as suas parcelas? Itens com pagamento registrado não podem ser excluídos."
              aoConfirmar={async () => {
                const resposta = await chamarPortal(adminPath, "itens-financeiros", "DELETE", { id: item.id });
                if (resposta.ok) router.refresh();
                return resposta.ok ? null : resposta.erro;
              }}
            />
          </div>
        )}
        {!somenteLeitura && modo === "parcela" && <FormularioParcela adminPath={adminPath} itemId={item.id} contratado={item.valorContratadoCentavos} posicao={item.parcelas.length + 1} aoFechar={() => setModo(null)} />}
        {item.parcelas.length === 0 && <p className="fin-observacao">Nenhuma parcela cadastrada para este item.</p>}
        {item.parcelas.length > 0 && (
          <ul className="flex flex-col gap-3">
            {item.parcelas.map((parcela, indice) => (
              <LinhaParcela key={parcela.id} adminPath={adminPath} itemId={item.id} contratado={item.valorContratadoCentavos} posicao={indice + 1}
                total={item.parcelas.length} parcela={parcela} observacao={observacoes[parcela.id] ?? null} nomeProjeto={null}
                hoje={hoje} somenteLeitura={somenteLeitura} ehContrato={false} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function EditorFinanceiro({ adminPath, empreendimentoId, itens, observacoes, fornecedores, hoje, somenteLeitura = false }: Props) {
  const [criando, setCriando] = useState(false);
  return (
    <section className="flex flex-col gap-5" aria-labelledby="titulo-itens-fornecedores">
      <h3 id="titulo-itens-fornecedores" className="text-xl font-medium">Itens de fornecedores</h3>
      {somenteLeitura ? null : criando ? (
        <Card className="p-5">
          <h4 className="mb-4 text-lg font-medium">Novo item de fornecedor</h4>
          <FormularioItem adminPath={adminPath} empreendimentoId={empreendimentoId} fornecedores={fornecedores} aoFechar={() => setCriando(false)} />
        </Card>
      ) : (
        <div><Button type="button" size="sm" onClick={() => setCriando(true)}><Plus aria-hidden="true" />Novo item</Button></div>
      )}
      {itens.length === 0 && !criando && <p className="portal-descricao">Nenhum item de fornecedor neste empreendimento.</p>}
      {itens.map((item) => (
        <CartaoItemAdmin key={item.id} adminPath={adminPath} empreendimentoId={empreendimentoId} item={item}
          observacoes={observacoes} fornecedores={fornecedores} hoje={hoje} somenteLeitura={somenteLeitura} />
      ))}
    </section>
  );
}
