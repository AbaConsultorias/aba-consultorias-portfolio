import Link from "next/link";
import { CopyPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Fotos } from "@/components/portal/andamento/Fotos";
import { SeloSituacao } from "@/components/portal/comum/SeloSituacao";
import { rotuloStatus, rotuloSituacao } from "@/lib/portal/obras/regras";
import type { RelatoObra } from "@/lib/portal/obras/tipos";

export function Relato({ relato, permitirNovo = false }: { relato: RelatoObra; permitirNovo?: boolean }) {
  return <div className="space-y-4">
    <div className="obras-resumo"><SeloSituacao situacao={relato.status}>{rotuloStatus(relato.status)}</SeloSituacao><time className="text-sm text-muted-foreground" dateTime={relato.criadoEm}>{new Date(relato.criadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</time></div>
    <p className="whitespace-pre-wrap leading-relaxed">{relato.texto}</p>
    <p className="text-sm text-muted-foreground">Informado no relato: {relato.percentualInformado === null ? "percentual não informado" : `${relato.percentualInformado}%`}{" · "}{relato.situacaoInformada ? rotuloSituacao(relato.situacaoInformada) : "situação não informada"}</p>
    {relato.revisadoEm && <p className="text-sm text-muted-foreground">Revisado em {new Date(relato.revisadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</p>}
    {relato.status === "devolvido" && <div className="obras-aviso"><p className="font-medium">Motivo da devolução</p><p className="mt-2 whitespace-pre-wrap">{relato.motivoDevolucao}</p></div>}
    <Fotos fotos={relato.fotos} />
    {permitirNovo && relato.status === "devolvido" && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`/empreiteiro/obras/${relato.obraId}/relatos/novo?baseadoEm=${relato.id}`}><CopyPlus size={18} aria-hidden="true" />Novo relato a partir deste</Link></Button>}
  </div>;
}
