"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, FileText, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { Formulario, type Campo, type OpcaoCampo } from "@/components/admin/portal/andamento/Formulario";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { CartaoDeSugestao } from "@/components/admin/portal/etapas/CartaoDeSugestao";
import { criarSchema, atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/projetos/schema";
import type { NoDaArvore, ProjetoLinha } from "./arvore";
import { ConfirmarRemocao } from "./ConfirmarRemocao";
import { Selo, plural } from "./Selos";

// A rota de ordem aceita até 100 irmãos de uma vez (ver ordenarSchema).
const MAXIMO_DE_IRMAOS = 100;

type Contexto = { adminPath: string; podeEditar: boolean; opcoesPai: OpcaoCampo[]; movendo: boolean; mover: (projeto: ProjetoLinha, delta: -1 | 1) => void };

function campoPai(opcoes: OpcaoCampo[]): Campo {
  return { nome: "projetoPaiId", rotulo: "Depende de (opcional)", tipo: "select", nullable: true, opcoes };
}

function LinhaDeProjeto({ no, contexto }: { no: NoDaArvore; contexto: Contexto }) {
  const router = useRouter();
  const { projeto } = no;
  const [modo, setModo] = useState<"ver" | "editar" | "excluir">("ver");
  const { adminPath, podeEditar, movendo } = contexto;
  const posicao = projeto.irmaos.indexOf(projeto.id);
  const podeReordenar = podeEditar && posicao >= 0 && projeto.irmaos.length <= MAXIMO_DE_IRMAOS;
  // Um projeto não pode depender de si mesmo: tira a própria linha das opções de "Depende de".
  const camposDeEdicao = [{ nome: "nome", rotulo: "Nome do projeto" }, campoPai(contexto.opcoesPai.filter((opcao) => opcao.valor !== projeto.id))];
  return (
    <li className="min-w-0">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="font-medium [overflow-wrap:anywhere]">{projeto.nome}</p>
            {(projeto.modeloNome || projeto.nomePaiForaDaPagina) && (
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {projeto.modeloNome && <>Modelo: {projeto.modeloNome}</>}
                {projeto.modeloNome && projeto.nomePaiForaDaPagina && " · "}
                {projeto.nomePaiForaDaPagina && <>Depende de {projeto.nomePaiForaDaPagina}</>}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {projeto.etapaNome ? <Selo tom="info">Etapa: {projeto.etapaNome}</Selo> : !projeto.temEtapaAtual && <Selo tom="neutro">Sem etapa atual</Selo>}
              {projeto.documentos !== undefined && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <FileText className="size-4 shrink-0" aria-hidden="true" />
                  {projeto.documentos === null ? "Documentos: —" : plural(projeto.documentos, "documento", "documentos")}
                </span>
              )}
            </div>
            {projeto.sugestao && <CartaoDeSugestao adminPath={adminPath} projetoId={projeto.id} sugestao={projeto.sugestao} podeEditar={podeEditar} compacto />}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`/${adminPath}/portal/projetos/${projeto.id}`}>Abrir<span className="sr-only"> {projeto.nome}</span></Link></Button>
            {podeReordenar && (
              <>
                <Button type="button" variant="outline" className="portal-botao" aria-label={`Subir ${projeto.nome}`} disabled={movendo || posicao === 0} onClick={() => contexto.mover(projeto, -1)}><ArrowUp aria-hidden="true" />Subir</Button>
                <Button type="button" variant="outline" className="portal-botao" aria-label={`Descer ${projeto.nome}`} disabled={movendo || posicao === projeto.irmaos.length - 1} onClick={() => contexto.mover(projeto, 1)}><ArrowDown aria-hidden="true" />Descer</Button>
              </>
            )}
            {podeEditar && (
              <>
                <Button type="button" variant="outline" className="portal-botao" aria-expanded={modo === "editar"} onClick={() => setModo(modo === "editar" ? "ver" : "editar")}><Pencil aria-hidden="true" />Editar<span className="sr-only"> {projeto.nome}</span></Button>
                <Button type="button" variant="destructive" className="portal-botao" onClick={() => setModo("excluir")}><Trash2 aria-hidden="true" />Excluir<span className="sr-only"> {projeto.nome}</span></Button>
              </>
            )}
          </div>
        </div>
        {podeEditar && modo === "editar" && (
          <div className="mt-4 border-t pt-4">
            <Formulario schema={atualizarSchema} campos={camposDeEdicao} valores={{ id: projeto.id, nome: projeto.nome, projetoPaiId: projeto.projetoPaiId }}
              endpoint={`/${adminPath}/api/portal/projetos`} metodo="PATCH" aoSalvar={() => setModo("ver")} />
          </div>
        )}
        {podeEditar && modo === "excluir" && (
          <div className="mt-4">
            <ConfirmarRemocao adminPath={adminPath} recurso="projetos" id={projeto.id} aviso="Os projetos que dependem deste ficarão sem dependência. Confirmar remoção deste registro?"
              aoConcluir={() => { setModo("ver"); router.refresh(); }} aoCancelar={() => setModo("ver")} />
          </div>
        )}
      </div>
      {no.filhos.length > 0 && <Nos nos={no.filhos} contexto={contexto} aninhado />}
    </li>
  );
}

function Nos({ nos, contexto, aninhado = false }: { nos: NoDaArvore[]; contexto: Contexto; aninhado?: boolean }) {
  return (
    <ul className={aninhado ? "ml-3 mt-2 space-y-2 border-l-2 border-border pl-3 sm:ml-5 sm:pl-5" : "space-y-2"}>
      {nos.map((no) => <LinhaDeProjeto key={no.projeto.id} no={no} contexto={contexto} />)}
    </ul>
  );
}

export function SecaoProjetos({ adminPath, empreendimentoId, arvore, total, podeEditar, opcoesModelo, opcoesPai }: {
  adminPath: string; empreendimentoId: string; arvore: NoDaArvore[]; total: number; podeEditar: boolean; opcoesModelo: OpcaoCampo[]; opcoesPai: OpcaoCampo[];
}) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [erroOrdem, setErroOrdem] = useState("");
  const [gravando, setGravando] = useState(false);
  const [atualizando, iniciarAtualizacao] = useTransition();

  // A lista de irmãos vem do servidor; o botão troca o projeto com o vizinho e manda a lista inteira. Todos os
  // botões ficam travados até a página recarregar, para um segundo clique não partir de uma lista velha.
  async function mover(projeto: ProjetoLinha, delta: -1 | 1) {
    const origem = projeto.irmaos.indexOf(projeto.id);
    const destino = origem + delta;
    if (origem < 0 || destino < 0 || destino >= projeto.irmaos.length) return;
    const ids = [...projeto.irmaos];
    [ids[origem], ids[destino]] = [ids[destino], ids[origem]];
    setGravando(true);
    setAviso("");
    setErroOrdem("");
    const resposta = await chamarPortal(adminPath, "projetos/ordem", "POST", { empreendimentoId, projetoPaiId: projeto.projetoPaiId, ids });
    setGravando(false);
    if (!resposta.ok) {
      setErroOrdem(resposta.erro ?? "Não foi possível mudar a ordem.");
      return;
    }
    setAviso(`${projeto.nome} agora está na posição ${destino + 1} de ${ids.length}.`);
    iniciarAtualizacao(() => router.refresh());
  }

  const camposCriar: Campo[] = [{ nome: "nome", rotulo: "Nome do projeto" }, { nome: "modeloId", rotulo: "Modelo (ativos)", tipo: "select", opcoes: opcoesModelo }, campoPai(opcoesPai)];
  return (
    <section aria-labelledby="titulo-projetos" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-projetos" className="text-xl font-medium">Projetos</h2>
        {podeEditar && (
          <Button type="button" className="portal-botao" aria-expanded={criando} aria-controls="novo-projeto" onClick={() => { setAviso(""); setCriando(!criando); }}>
            {criando ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}{criando ? "Fechar" : "Novo projeto"}
          </Button>
        )}
      </div>
      {podeEditar && criando && (
        <div id="novo-projeto" className="space-y-4 rounded-2xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">O projeto copia as etapas e categorias do modelo escolhido; mudanças posteriores no modelo não o alteram.</p>
          <Formulario schema={criarSchema} campos={camposCriar} valores={{ empreendimentoId, modeloId: "", nome: "", projetoPaiId: null }} endpoint={`/${adminPath}/api/portal/projetos`} metodo="POST"
            rotulo="Criar projeto" aoSalvar={() => { setCriando(false); setAviso("Projeto criado."); }} />
        </div>
      )}
      {total > 0 && <p className="text-sm text-muted-foreground">A ordem aqui é a que o cliente vê.</p>}
      <p role="status" aria-live="polite" className="text-sm">{aviso}</p>
      <MensagemDeErro>{erroOrdem}</MensagemDeErro>
      {total === 0 ? (
        <div className="portal-vazio flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Layers className="size-7" aria-hidden="true" /></span>
          <h3 className="text-lg font-medium">Nenhum projeto neste empreendimento</h3>
          {podeEditar && <p>Use “Novo projeto” para criar o primeiro a partir de um modelo.</p>}
        </div>
      ) : <Nos nos={arvore} contexto={{ adminPath, podeEditar, opcoesPai, movendo: gravando || atualizando, mover }} />}
    </section>
  );
}
