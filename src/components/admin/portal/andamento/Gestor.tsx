"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Pencil, Trash2, X } from "lucide-react";
import z from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Formulario, type Campo } from "./Formulario";
import { NovaAtualizacao } from "./NovaAtualizacao";
import { alterarPublicacao } from "./uploadFoto";
import * as empreendimentos from "@/app/api/(modules)/adm-interno/portal/empreendimentos/schema";
import * as clientes from "@/app/api/(modules)/adm-interno/portal/clientes/schema";
import * as vinculos from "@/app/api/(modules)/adm-interno/portal/empreendimento-clientes/schema";
import * as modelos from "@/app/api/(modules)/adm-interno/portal/modelos/schema";
import * as projetos from "@/app/api/(modules)/adm-interno/portal/projetos/schema";
import * as etapas from "@/app/api/(modules)/adm-interno/portal/projeto-etapas/schema";
import * as atualizacoes from "@/app/api/(modules)/adm-interno/portal/atualizacoes/schema";
const SCHEMAS: Record<string, { criarSchema?: z.ZodType; atualizarSchema?: z.ZodType; excluirSchema?: z.ZodType }> = { empreendimentos, clientes, "empreendimento-clientes": vinculos, modelos, projetos, "projeto-etapas": etapas, atualizacoes };
const MAPA: Record<string, string> = { empreendimento_id: "empreendimentoId", profile_id: "profileId", loteamento_id: "loteamentoId", projeto_id: "projetoId", etapa_id: "etapaId", data_visita: "dataVisita", etapa_atual_id: "etapaAtualId", projeto_pai_id: "projetoPaiId" };
function valoresDaLinha(linha: Record<string, unknown>) {
  const valor: Record<string, unknown> = {};
  for (const [chave, dado] of Object.entries(linha)) valor[MAPA[chave] ?? chave] = dado;
  for (const [origem, destino] of [["modelo_etapas_itens", "etapas"], ["modelo_categorias_documento", "categorias"], ["projeto_etapas", "etapas"], ["projeto_categorias_documento", "categorias"]]) {
    if (Array.isArray(linha[origem])) valor[destino] = (linha[origem] as Record<string, unknown>[]).map((item) => ({ id: item.id, nome: item.nome, ordem: item.ordem, ...(origem === "projeto_etapas" ? { concluidaEm: item.concluida_em } : {}), ...(origem === "modelo_etapas_itens" ? { marco: item.marco ?? null } : {}) }));
  }
  return valor;
}
// Um projeto não pode depender de si mesmo: tira a própria linha das opções de "Depende de".
function camposDaLinha(campos: Campo[], id: string): Campo[] {
  return campos.map((campo) => campo.nome === "projetoPaiId" && campo.opcoes ? { ...campo, opcoes: campo.opcoes.filter((opcao) => opcao.valor !== id) } : campo);
}
export function Gestor({ recurso, adminPath, registros, camposCriar = [], camposEditar = camposCriar, iniciais = {}, titulo, detalhe, apenasEditar = false, somenteLeitura = false, podeExcluir = true }: {
  recurso: keyof typeof SCHEMAS; adminPath: string; registros: Record<string, unknown>[]; camposCriar?: Campo[]; camposEditar?: Campo[]; iniciais?: Record<string, unknown>; titulo: string; detalhe?: "empreendimentos" | "projetos" | "atualizacoes"; apenasEditar?: boolean; somenteLeitura?: boolean; podeExcluir?: boolean;
}) {
  const router = useRouter();
  const [selecionado, setSelecionado] = useState<Record<string, unknown> | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [atualizando, iniciarAtualizacao] = useTransition();
  const [criacaoPendente, setCriacaoPendente] = useState<string | null>(null);
  const schema = SCHEMAS[recurso];
  const endpoint = `/${adminPath}/api/portal/${recurso}`;
  async function publicar(id: string, publicado: boolean) {
    if (ocupado || atualizando || criacaoPendente === id || selecionado?.id === id) return;
    setOcupado(true); setMensagem("");
    try {
      await alterarPublicacao(endpoint, id, publicado);
      setMensagem(publicado ? "Atualização publicada para o cliente." : "Atualização ocultada. Salva como rascunho.");
    } catch { setMensagem("Não foi possível confirmar a alteração. Confira a situação atual e tente novamente."); }
    finally { setOcupado(false); iniciarAtualizacao(() => router.refresh()); }
  }
  async function excluir(id: string) {
    setOcupado(true); setMensagem("");
    try {
      const resposta = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const json: unknown = await resposta.json();
      const resultado = z.object({ details: z.unknown().optional() }).parse(json);
      if (!resposta.ok) { setMensagem(typeof resultado.details === "string" ? resultado.details : "Não foi possível excluir."); return; }
      setExcluindo(null); router.refresh();
    } catch { setMensagem("Falha de conexão. Tente novamente."); } finally { setOcupado(false); }
  }
  return <section className="space-y-6"><h2 className="text-xl font-medium">{titulo}</h2>
    {!somenteLeitura && !apenasEditar && schema.criarSchema && <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-medium">Adicionar</summary><div className="mt-5">{recurso === "atualizacoes"
      ? <NovaAtualizacao key={String(iniciais.empreendimentoId)} adminPath={adminPath} campos={camposCriar} valores={iniciais} aoPendencia={setCriacaoPendente} />
      : <Formulario schema={schema.criarSchema} campos={camposCriar} valores={iniciais} endpoint={endpoint} metodo="POST" />}</div></details>}
    {!registros.length && <p className="portal-vazio">Nenhum registro nesta página.</p>}
    <div className="space-y-4">{registros.map((linha) => {
      const id = String(linha.id);
      const bloqueado = ocupado || atualizando || criacaoPendente === id;
      const nomePai = recurso === "projetos" && typeof linha.projeto_pai_id === "string"
        ? camposEditar.find((campo) => campo.nome === "projetoPaiId")?.opcoes?.find((opcao) => opcao.valor === linha.projeto_pai_id)?.nome
        : undefined;
      return <Card key={id} className="p-5"><h3 className="font-semibold">{String(linha.nome ?? linha.titulo ?? (linha.profiles as { nome?: string } | undefined)?.nome ?? "Etapas do projeto")}</h3>
        {nomePai && <p className="text-sm text-muted-foreground">Depende de {nomePai}</p>}
        {linha.situacao !== undefined && <p className="text-sm text-muted-foreground">{String(linha.situacao)}</p>}
        {linha.publicado !== undefined && <p className="text-sm text-muted-foreground">{linha.publicado ? "Publicada" : "Rascunho"}</p>}
        {linha.ativo !== undefined && <p className="text-sm text-muted-foreground">{linha.ativo ? "Ativo" : "Inativo"}{linha.precisa_trocar_senha ? " · Troca de senha obrigatória" : ""}</p>}
        {criacaoPendente === id && <p className="text-sm text-muted-foreground">Conclua os envios ou escolha editar depois no formulário acima antes de publicar.</p>}
        <div className="mt-3 flex flex-wrap gap-2">{detalhe && criacaoPendente !== id && <Button asChild variant="outline"><Link prefetch={false} href={detalhe === "atualizacoes" ? `/${adminPath}/portal/atualizacoes?atualizacaoId=${id}` : `/${adminPath}/portal/${detalhe}/${id}`}>{detalhe === "atualizacoes" ? "Fotos" : "Abrir"}</Link></Button>}
          {!somenteLeitura && recurso === "atualizacoes" && <Button variant="outline" disabled={bloqueado || selecionado?.id === linha.id} onClick={() => publicar(id, !linha.publicado)}>{linha.publicado ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{linha.publicado ? "Ocultar" : "Publicar"}</Button>}
          {!somenteLeitura && schema.atualizarSchema && <Button variant="outline" disabled={bloqueado} onClick={() => setSelecionado(linha)}><Pencil aria-hidden="true" />Editar</Button>}
          {!somenteLeitura && podeExcluir && schema.excluirSchema && <Button variant="destructive" disabled={bloqueado} onClick={() => setExcluindo(id)}><Trash2 aria-hidden="true" />{recurso === "empreendimento-clientes" ? "Desvincular" : "Excluir"}</Button>}
        </div>
        {excluindo === id && <div className="mt-4 space-y-3"><p className="text-sm">{recurso === "empreendimentos" ? "Prefira arquivar para preservar o histórico. " : recurso === "projetos" ? "Os projetos que dependem deste ficarão sem dependência. " : ""}Confirmar remoção deste registro?</p><Button variant="destructive" disabled={ocupado} onClick={() => excluir(id)}><Check aria-hidden="true" />Confirmar remoção</Button><Button variant="outline" onClick={() => setExcluindo(null)}><X aria-hidden="true" />Cancelar</Button></div>}
        {selecionado?.id === linha.id && schema.atualizarSchema && <div className="mt-5 border-t pt-5"><Formulario key={`${id}-${linha.publicado}`} schema={schema.atualizarSchema} campos={camposDaLinha(camposEditar, id)} valores={valoresDaLinha(linha)} endpoint={endpoint} metodo="PATCH" aoSalvar={() => setSelecionado(null)} /><Button variant="outline" onClick={() => setSelecionado(null)}><X aria-hidden="true" />Fechar edição</Button></div>}
      </Card>;
    })}</div><p role="status">{mensagem}</p>
  </section>;
}
