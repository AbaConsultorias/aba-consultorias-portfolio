"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { diferencaPrevisto, formatarBRL, formatarDataCivil, nomeDoProjetoDaParcela, situacaoDoItem } from "@/lib/portal/financeiro/regras";
import type { ItemFinanceiroPortal } from "@/lib/portal/financeiro/tipos";
import { ResumoItemFinanceiro } from "@/components/portal/financeiro/ResumoItemFinanceiro";
import "@/components/portal/financeiro/financeiro.css";
import { EditorContrato, type DocumentoOpcao, type ProjetoOpcao } from "./EditorContrato";
import { LinhaParcela } from "./LinhaParcela";
import { chamarPortal } from "./requisicao";

type Props = {
  adminPath: string;
  empreendimentoId: string;
  contratos: readonly ItemFinanceiroPortal[];
  observacoes: Record<string, string | null>;
  projetos: readonly ProjetoOpcao[];
  documentos: readonly DocumentoOpcao[];
  podeEscolherPdf: boolean;
  hoje: string;
  somenteLeitura: boolean;
};

function CartaoContrato({ adminPath, empreendimentoId, item, observacoes, projetos, documentos, podeEscolherPdf, hoje, somenteLeitura }: Omit<Props, "contratos"> & { item: ItemFinanceiroPortal }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const diferenca = diferencaPrevisto(item.valorContratadoCentavos, item.parcelas);
  const tituloPdf = documentos.find((documento) => documento.id === item.documentoId)?.titulo;
  return (
    <details className="fin-item" data-estado={situacaoDoItem(item, hoje)}>
      <ResumoItemFinanceiro item={item} hoje={hoje} />
      <div className="fin-item-conteudo fin-admin-item">
        {editando ? (
          <EditorContrato adminPath={adminPath} empreendimentoId={empreendimentoId} item={item} projetos={projetos}
            documentos={documentos} podeEscolherPdf={podeEscolherPdf} aoFechar={() => setEditando(false)} />
        ) : (
          <>
            <dl className="fin-contrato-dados">
              <div><dt>Assinatura</dt><dd>{item.assinadoEm ? formatarDataCivil(item.assinadoEm) : "Ainda não assinado"}</dd></div>
              <div>
                <dt>PDF do contrato</dt>
                <dd>
                  {item.documentoId
                    ? <a href={`/api/portal/documentos/${item.documentoId}/download`} target="_blank" rel="noopener"><ExternalLink size={14} aria-hidden="true" />{tituloPdf ?? "Abrir PDF"}</a>
                    : "Sem PDF ligado"}
                </dd>
              </div>
              <div>
                <dt>Projetos</dt>
                <dd>
                  {item.projetos.length === 0 ? "Nenhum projeto ligado" : (
                    <span className="fin-chips">{item.projetos.map((projeto) => <span key={projeto.id} className="fin-chip">{projeto.nome}</span>)}</span>
                  )}
                </dd>
              </div>
              <div><dt>Total do contrato</dt><dd>{formatarBRL(item.valorContratadoCentavos)}</dd></div>
            </dl>
            {BigInt(diferenca) !== BigInt(0) && (
              <p role="status" className="text-sm text-muted-foreground">
                Conferência: as parcelas previstas somam {formatarBRL((BigInt(item.valorContratadoCentavos) - BigInt(diferenca)).toString())},
                {" "}{BigInt(diferenca) > BigInt(0) ? `${formatarBRL(diferenca)} a menos` : `${formatarBRL((-BigInt(diferenca)).toString())} a mais`} que o valor contratado.
              </p>
            )}
            {item.observacao && <p className="fin-observacao">{item.observacao}</p>}
            {!somenteLeitura && (
              <div className="fin-admin-acoes">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)}><Pencil aria-hidden="true" />Editar contrato</Button>
                <ConfirmarExclusao
                  rotulo="Excluir contrato"
                  aviso="Excluir o contrato, suas parcelas e os eventos ligados a ele? Contratos com pagamento registrado não podem ser excluídos."
                  aoConfirmar={async () => {
                    const resposta = await chamarPortal(adminPath, "itens-financeiros", "DELETE", { id: item.id });
                    if (resposta.ok) router.refresh();
                    return resposta.ok ? null : resposta.erro;
                  }}
                />
              </div>
            )}
            {item.parcelas.length === 0 && <p className="fin-observacao">Nenhuma parcela cadastrada neste contrato.</p>}
            {item.parcelas.length > 0 && (
              <ul className="flex flex-col gap-3">
                {item.parcelas.map((parcela, indice) => (
                  <LinhaParcela key={parcela.id} adminPath={adminPath} itemId={item.id} contratado={item.valorContratadoCentavos}
                    posicao={indice + 1} total={item.parcelas.length} parcela={parcela} observacao={observacoes[parcela.id] ?? null}
                    nomeProjeto={nomeDoProjetoDaParcela(item, parcela)} hoje={hoje} somenteLeitura={somenteLeitura} ehContrato />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </details>
  );
}

export function SecaoContratos({ contratos, ...props }: Props) {
  const [criando, setCriando] = useState(false);
  return (
    <section className="flex flex-col gap-5" aria-labelledby="titulo-contratos-aba">
      <h3 id="titulo-contratos-aba" className="text-xl font-medium">Contratos da ABA</h3>
      {props.somenteLeitura ? null : criando ? (
        <Card className="p-5">
          <h4 className="mb-4 text-lg font-medium">Novo contrato</h4>
          <EditorContrato adminPath={props.adminPath} empreendimentoId={props.empreendimentoId} projetos={props.projetos}
            documentos={props.documentos} podeEscolherPdf={props.podeEscolherPdf} aoFechar={() => setCriando(false)} />
        </Card>
      ) : (
        <div><Button type="button" size="sm" onClick={() => setCriando(true)}><Plus aria-hidden="true" />Novo contrato</Button></div>
      )}
      {contratos.length === 0 && !criando && <p className="portal-descricao">Nenhum contrato da ABA cadastrado neste empreendimento ainda.</p>}
      {contratos.map((item) => <CartaoContrato key={item.id} item={item} {...props} />)}
    </section>
  );
}
