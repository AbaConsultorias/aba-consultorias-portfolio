import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeloSituacao } from "@/components/portal/comum/SeloSituacao";
import { formatarTamanho } from "@/lib/portal/documentos/regras";
import { ROTULOS_DOCUMENTO } from "@/lib/portal/fornecedor/regras";
import type { ContratoFornecedor, DocumentoFornecedor } from "@/lib/portal/fornecedor/tipos";

export function ListaArquivos({ registros }: { registros: readonly (ContratoFornecedor | DocumentoFornecedor)[] }) {
  if (!registros.length) return <p className="portal-vazio">Nenhum arquivo disponível.</p>;
  return <ul className="forn-lista">{registros.map((arquivo) => <li key={arquivo.id} className="forn-caixa">
    <div className="forn-linha"><FileText aria-hidden="true" size={24} /><h2>{arquivo.titulo}</h2>{"status" in arquivo && <SeloSituacao situacao={arquivo.status}>{{ pendente: "Aguardando revisão", aprovado: "Aprovado", recusado: "Recusado" }[arquivo.status]}</SeloSituacao>}</div>
    <p className="forn-ajuda">{arquivo.empreendimentoNome ?? "Sem empreendimento informado"} · {formatarTamanho(arquivo.tamanho)} · {new Date(arquivo.criadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
    {"tipo" in arquivo && <p>{ROTULOS_DOCUMENTO[arquivo.tipo]}</p>}
    {"motivo" in arquivo && arquivo.motivo && <p className="forn-aviso"><strong>Motivo da recusa:</strong> {arquivo.motivo} Corrija o documento e faça um novo envio.</p>}
    <Button asChild variant="outline" className="portal-botao"><a href={arquivo.downloadHref}><Download size={18} aria-hidden="true" />Baixar arquivo</a></Button>
  </li>)}</ul>;
}
