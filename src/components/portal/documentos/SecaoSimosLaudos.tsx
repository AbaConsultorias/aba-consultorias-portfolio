import Link from "next/link";
import { Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentoPortal } from "@/lib/portal/documentos/tipos";

type Props = { empreendimentoId: string; documentos: DocumentoPortal[] };
type LinhaDeEquipamento = { equipamento: string; simos: DocumentoPortal[]; laudos: DocumentoPortal[] };

function agruparPorEquipamento(documentos: readonly DocumentoPortal[]): LinhaDeEquipamento[] {
  const linhas = new Map<string, LinhaDeEquipamento>();
  for (const documento of documentos) {
    if (!documento.equipamento || !documento.equipamentoPapel) continue;
    const linha = linhas.get(documento.equipamento) ?? { equipamento: documento.equipamento, simos: [], laudos: [] };
    (documento.equipamentoPapel === "simo" ? linha.simos : linha.laudos).push(documento);
    linhas.set(documento.equipamento, linha);
  }
  return [...linhas.values()].sort((a, b) => a.equipamento.localeCompare(b.equipamento, "pt-BR", { numeric: true }));
}

export const ehDeEquipamento = (documento: Pick<DocumentoPortal, "equipamento" | "equipamentoPapel">) =>
  Boolean(documento.equipamento && documento.equipamentoPapel);

// O SIMO só se visualiza (o arquivo não é entregue ao cliente); o Laudo também se baixa, como os outros documentos.
export function SecaoSimosLaudos({ empreendimentoId, documentos }: Props) {
  const linhas = agruparPorEquipamento(documentos);
  if (linhas.length === 0) return null;
  const hrefDoVisualizador = (documento: DocumentoPortal) => `/cliente/empreendimentos/${empreendimentoId}/documentos/${documento.id}/visualizar`;

  return (
    <section className="portal-docs-grupo" aria-label="SIMOS e Laudos">
      <h3>SIMOS e Laudos</h3>
      <div className="portal-equip-rolagem">
        <table className="portal-equip">
          <thead>
            <tr><th scope="col">Equipamento</th><th scope="col">SIMO</th><th scope="col">Laudo Copasa</th></tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.equipamento}>
                <th scope="row" data-rotulo="Equipamento">{linha.equipamento}</th>
                <td data-rotulo="SIMO">
                  {linha.simos.length === 0 ? <span className="portal-equip-aguardando">aguardando</span> : (
                    <ul className="portal-equip-acoes">
                      {linha.simos.map((documento) => (
                        <li key={documento.id}>
                          {linha.simos.length > 1 && <span className="portal-equip-nome">{documento.titulo}</span>}
                          <Button asChild variant="outline" size="sm" className="portal-botao">
                            <Link href={hrefDoVisualizador(documento)} prefetch={false} aria-label={`Visualizar ${documento.titulo}`}>
                              <Eye size={18} aria-hidden="true" />Visualizar
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td data-rotulo="Laudo Copasa">
                  {linha.laudos.length === 0 ? <span className="portal-equip-aguardando">aguardando</span> : (
                    <ul className="portal-equip-acoes">
                      {linha.laudos.map((documento) => (
                        <li key={documento.id}>
                          {linha.laudos.length > 1 && <span className="portal-equip-nome">{documento.titulo}</span>}
                          <Button asChild variant="outline" size="sm" className="portal-botao">
                            <Link href={hrefDoVisualizador(documento)} prefetch={false} aria-label={`Visualizar ${documento.titulo}`}>
                              <Eye size={18} aria-hidden="true" />Visualizar
                            </Link>
                          </Button>
                          <Button asChild variant="outline" size="sm" className="portal-botao">
                            <a href={documento.downloadHref} aria-label={`Baixar ${documento.titulo}`}>
                              <Download size={18} aria-hidden="true" />Baixar
                            </a>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
