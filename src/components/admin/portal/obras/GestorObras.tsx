"use client";
import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck, Pencil, Plus, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Formulario, type Campo } from "@/components/admin/portal/andamento/Formulario";
import { criarSchema, atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/obras/schema";
import { criarSchema as vincularSchema } from "@/app/api/(modules)/adm-interno/portal/obra-empreiteiros/schema";
import { ResumoObra } from "@/components/portal/obras/ResumoObra";
import { SITUACOES_OBRA } from "@/lib/portal/obras/regras";
import type { ObraAdmin } from "@/lib/portal/obras/tipos";
import type { ContaPortal } from "@/lib/portal/comum/contas";
import { ExcluirRegistro } from "./ExcluirRegistro";

const campos: Campo[] = [
  { nome: "nome", rotulo: "Nome da obra" },
  { nome: "previstoInicio", rotulo: "Início previsto (opcional)", tipo: "data", nullable: true },
  { nome: "previstoFim", rotulo: "Fim previsto (opcional)", tipo: "data", nullable: true },
  { nome: "situacao", rotulo: "Situação oficial", tipo: "select", opcoes: [...SITUACOES_OBRA] },
  { nome: "percentual", rotulo: "Percentual oficial (0 a 100)", tipo: "numero" },
];
export function GestorObras({ adminPath, empreendimentoId, obras, contas, somenteLeitura = false }: { adminPath: string; empreendimentoId: string; obras: ObraAdmin[]; contas: ContaPortal[]; somenteLeitura?: boolean }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState<string | null>(null);
  const endpoint = `/${adminPath}/api/portal/obras`;
  const vinculos = `/${adminPath}/api/portal/obra-empreiteiros`;
  return <div className="obras-painel">
    {!somenteLeitura && <details className="obras-cartao"><summary className="min-h-11 cursor-pointer font-medium">Cadastrar obra</summary><div className="mt-5"><Formulario schema={criarSchema} campos={campos} valores={{ empreendimentoId, nome: "", previstoInicio: null, previstoFim: null, situacao: "planejada", percentual: 0 }} endpoint={endpoint} metodo="POST" rotulo="Cadastrar obra" Icone={Plus} /></div></details>}
    {!obras.length && <p className="portal-vazio">Nenhuma obra cadastrada neste empreendimento.</p>}
    {obras.map((obra) => <article key={obra.id} className="obras-cartao space-y-5">
      <h3>{obra.nome}</h3><ResumoObra obra={obra} />
      <div className="obras-acoes">{!somenteLeitura && <Button variant="outline" onClick={() => setEditando(editando === obra.id ? null : obra.id)} aria-expanded={editando === obra.id}>{editando === obra.id ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}{editando === obra.id ? "Fechar edição" : "Editar obra"}</Button>}<Button asChild variant="outline"><Link prefetch={false} href={`/${adminPath}/portal/relatos?obraId=${obra.id}`}><ClipboardCheck aria-hidden="true" />Revisar relatos</Link></Button></div>
      {!somenteLeitura && editando === obra.id && <Formulario schema={atualizarSchema} campos={campos} valores={{ id: obra.id, nome: obra.nome, previstoInicio: obra.previstoInicio, previstoFim: obra.previstoFim, situacao: obra.situacao, percentual: obra.percentual }} endpoint={endpoint} metodo="PATCH" aoSalvar={() => setEditando(null)} />}
      <div className="space-y-4"><h4 className="font-medium">Empreiteiros atribuídos</h4>{!obra.empreiteiros.length && <p className="text-sm text-muted-foreground">Nenhum empreiteiro atribuído.</p>}
        {obra.empreiteiros.map((pessoa) => <div key={pessoa.vinculoId} className="rounded-lg border p-4"><p className={somenteLeitura ? undefined : "mb-3"}>{pessoa.nome}{!pessoa.ativo && " · Conta inativa"}</p>{!somenteLeitura && <ExcluirRegistro endpoint={vinculos} id={pessoa.vinculoId} rotulo="Remover acesso" explicacao="Ao remover, este empreiteiro perde o acesso à obra, aos seus relatos e às fotos. O histórico será preservado." />}</div>)}
        {!somenteLeitura && <Button variant="outline" onClick={() => setVinculando(vinculando === obra.id ? null : obra.id)} aria-expanded={vinculando === obra.id}><UserPlus aria-hidden="true" />Atribuir empreiteiro</Button>}
        {!somenteLeitura && vinculando === obra.id && <Formulario schema={vincularSchema} campos={[{ nome: "profileId", rotulo: "Empreiteiro", tipo: "select", opcoes: contas.filter((conta) => conta.ativo && !obra.empreiteiros.some((pessoa) => pessoa.profileId === conta.id)).map((conta) => ({ valor: conta.id, nome: conta.nome })) }]} valores={{ obraId: obra.id, profileId: "" }} endpoint={vinculos} metodo="POST" rotulo="Atribuir" Icone={UserPlus} aoSalvar={() => setVinculando(null)} />}
        {!somenteLeitura && <div><Button asChild variant="outline"><Link prefetch={false} href={`/${adminPath}/portal/empreiteiros`}><Users aria-hidden="true" />Cadastrar ou editar contas de empreiteiro</Link></Button></div>}
      </div>
      {!somenteLeitura && <ExcluirRegistro endpoint={endpoint} id={obra.id} rotulo="Excluir obra" explicacao="Excluir esta obra e seus vínculos? Obras com relatos não podem ser excluídas." />}
    </article>)}
  </div>;
}
