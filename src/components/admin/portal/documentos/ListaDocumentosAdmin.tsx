"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink, Eye, EyeOff, FileText, History, Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { rotuloDeEquipamento } from "@/lib/portal/conector/fila";
import { agruparDocumentosPorProjeto, formatarTamanho, ordenarCartoesPorArvore } from "@/lib/portal/documentos/regras";
import { CartaoProjetoDocumentos } from "@/components/portal/documentos/CartaoProjetoDocumentos";
import "@/components/portal/documentos/documentos.css";
import type { DocumentoAdmin, DownloadDocumento, EstruturaDocumentos } from "@/lib/portal/documentos/tipos";
import { chamarPortal } from "./api";
import { BarraAcoesEmLote, CaixaDoDocumento, SelecionarTodos, useSelecaoEmLote, type SelecaoEmLote } from "./SelecaoEmLote";

type Props = {
  adminPath: string;
  documentos: DocumentoAdmin[];
  nomesEmpreendimento: Record<string, string>;
  // Só existe com um empreendimento filtrado; sem ele, a edição se limita ao título.
  estrutura: EstruturaDocumentos | null;
  estruturaAgrupamento: EstruturaDocumentos;
  ehAdmin: boolean;
  // Sem documentos.editar a lista aparece sem editar nem excluir; liberar e ocultar dependem de documentos.liberar.
  somenteLeitura?: boolean;
  podeLiberar?: boolean;
  hrefAnterior: string | null;
  hrefProxima: string | null;
  cartoesAbertos?: boolean;
};

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const ehPdf = (documento: DocumentoAdmin) => documento.mime === "application/pdf";
const idsDosPdfs = (documentos: readonly DocumentoAdmin[]) => documentos.filter(ehPdf).map((documento) => documento.id);

export function ListaDocumentosAdmin({ documentos, hrefAnterior, hrefProxima, estruturaAgrupamento, cartoesAbertos = false, ...resto }: Props) {
  const { podeLiberar = true } = resto;
  const selecao = useSelecaoEmLote(resto.adminPath, podeLiberar ? idsDosPdfs(documentos) : []);
  if (documentos.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-medium">Nenhum documento</h2>
        <p className="mt-1 text-sm text-muted-foreground">Envie o primeiro PDF para disponibilizar ao cliente.</p>
        {hrefAnterior && <Button asChild variant="outline" className="portal-botao mt-3"><Link href={hrefAnterior} prefetch={false}><ArrowLeft size={18} aria-hidden="true" />Voltar à página anterior</Link></Button>}
      </div>
    );
  }
  const projetos = agruparDocumentosPorProjeto(documentos, estruturaAgrupamento.projetos, estruturaAgrupamento.categorias);
  return (
    <div className="portal-docs">
      {(hrefAnterior || hrefProxima) && <p className="portal-docs-nota">As contagens correspondem aos documentos desta página e aos filtros aplicados.</p>}
      {podeLiberar && <BarraAcoesEmLote selecao={selecao} />}
      {ordenarCartoesPorArvore(projetos, estruturaAgrupamento.projetos).map(({ cartao: projeto, nivel, dependeDe }) => (
        <CartaoProjetoDocumentos key={projeto.chave} projetoId={projeto.projetoId} nome={projeto.nome} quantidade={projeto.quantidade}
          nivel={nivel} dependeDe={dependeDe} abertoAoCarregar={cartoesAbertos}
          liberados={projeto.categorias.reduce((total, grupo) => total + grupo.documentos.filter((doc) => doc.liberadoCliente).length, 0)}>
          {podeLiberar && (
            <SelecionarTodos selecao={selecao} ids={idsDosPdfs(projeto.categorias.flatMap((grupo) => grupo.documentos))}
              rotulo="Selecionar todos do projeto" descricao={`Selecionar todos os documentos de ${projeto.nome}`} />
          )}
          {projeto.categorias.map((grupo) => {
            const nomeDaCategoria = grupo.categoria ?? (projeto.grupo ? projeto.nome : "Sem categoria");
            return (
              <section key={grupo.chave} className="portal-docs-grupo" aria-label={nomeDaCategoria}>
                {!(projeto.grupo && !grupo.categoria) && <h3>{grupo.categoria ?? "Sem categoria"}</h3>}
                {podeLiberar && (
                  <SelecionarTodos selecao={selecao} ids={idsDosPdfs(grupo.documentos)}
                    rotulo="Selecionar todos da categoria" descricao={`Selecionar todos os documentos da categoria ${nomeDaCategoria}`} />
                )}
                <ul className="portal-docs-lista">
                  {grupo.documentos.map((documento) => <LinhaDocumento key={documento.id} documento={documento} selecao={podeLiberar ? selecao : null} {...resto} />)}
                </ul>
              </section>
            );
          })}
        </CartaoProjetoDocumentos>
      ))}
      {(hrefAnterior || hrefProxima) && (
        <nav aria-label="Paginação" className="mt-4 flex justify-between gap-3">
          {hrefAnterior ? <Button asChild variant="outline" className="portal-botao"><Link href={hrefAnterior} prefetch={false}><ArrowLeft size={18} aria-hidden="true" />Anteriores</Link></Button> : <span />}
          {hrefProxima && <Button asChild variant="outline" className="portal-botao"><Link href={hrefProxima} prefetch={false}>Próximos<ArrowRight size={18} aria-hidden="true" /></Link></Button>}
        </nav>
      )}
    </div>
  );
}

type PropsLinha = Omit<Props, "documentos" | "hrefAnterior" | "hrefProxima" | "estruturaAgrupamento"> & {
  documento: DocumentoAdmin;
  // Nulo sem documentos.liberar: a linha aparece sem caixa de seleção.
  selecao: SelecaoEmLote | null;
};

function LinhaDocumento({ adminPath, documento, nomesEmpreendimento, estrutura, ehAdmin, somenteLeitura = false, podeLiberar = true, selecao }: PropsLinha) {
  const router = useRouter();
  const [trabalhando, setTrabalhando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [mostrarDownloads, setMostrarDownloads] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [titulo, setTitulo] = useState(documento.titulo);
  const [projetoId, setProjetoId] = useState(documento.projetoId ?? "");
  const [categoriaId, setCategoriaId] = useState(documento.categoriaId ?? "");

  async function alterar(corpo: Record<string, unknown>): Promise<boolean> {
    setTrabalhando(true);
    setErro(null);
    const resposta = await chamarPortal(adminPath, "documentos", "PATCH", { id: documento.id, ...corpo });
    setTrabalhando(false);
    if (!resposta.ok) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return false;
    }
    router.refresh();
    return true;
  }

  async function salvarEdicao() {
    const corpo: Record<string, unknown> = { titulo };
    if (estrutura) {
      corpo.projetoId = projetoId || null;
      corpo.categoriaId = projetoId && categoriaId ? categoriaId : null;
    }
    if (await alterar(corpo)) setEditando(false);
  }

  async function excluir(): Promise<string | null> {
    const resposta = await chamarPortal(adminPath, "documentos", "DELETE", { id: documento.id });
    if (!resposta.ok) return resposta.erro;
    router.refresh();
    return null;
  }

  const projeto = estrutura?.projetos.find((item) => item.id === documento.projetoId)?.nome;
  const categoria = estrutura?.categorias.find((item) => item.id === documento.categoriaId)?.nome;
  const categoriasDoProjeto = estrutura?.categorias.filter((item) => item.projetoId === projetoId) ?? [];
  const pdf = ehPdf(documento);
  const emLote = selecao?.trabalhando ?? false;
  const podeExcluir = !somenteLeitura && (!documento.liberadoCliente || podeLiberar);

  return (
    <li className="portal-entrada rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        {selecao && pdf && <CaixaDoDocumento selecao={selecao} id={documento.id} titulo={documento.titulo} />}
        <FileText size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{documento.titulo}</p>
          {documento.equipamento && documento.equipamentoPapel && (
            <p className="mt-1"><span className="inline-flex rounded-full border px-3 py-1 text-xs">{rotuloDeEquipamento(documento)}</span></p>
          )}
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {[nomesEmpreendimento[documento.empreendimentoId], projeto, categoria, formatarTamanho(documento.tamanho), `Enviado em ${data(documento.criadoEm)}`]
              .filter(Boolean).join(" · ")}
          </p>
          <p className="mt-2">
            <span className="inline-flex rounded-full border px-3 py-1 text-xs" data-liberado={documento.liberadoCliente}>
              {documento.liberadoCliente && documento.liberadoEm ? `Liberado em ${data(documento.liberadoEm)}` : "Oculto para o cliente"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pdf && podeLiberar && (
            <Button size="sm" variant={documento.liberadoCliente ? "outline" : "default"} disabled={trabalhando || emLote} aria-busy={trabalhando}
              onClick={() => alterar({ liberado: !documento.liberadoCliente })}>
              {documento.liberadoCliente ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {documento.liberadoCliente ? "Ocultar" : "Liberar"}
            </Button>
          )}
          {!somenteLeitura && (
            <Button size="sm" variant="outline" disabled={trabalhando} aria-expanded={editando} onClick={() => setEditando(!editando)}>
              <Pencil aria-hidden="true" />Editar
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/portal/documentos/${documento.id}/download`} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />Abrir</a>
          </Button>
          {ehAdmin && (
            <Button size="sm" variant="outline" aria-expanded={mostrarDownloads} onClick={() => setMostrarDownloads(!mostrarDownloads)}>
              <History aria-hidden="true" />Downloads
            </Button>
          )}
        </div>
      </div>

      {editando && !somenteLeitura && (
        <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">Título
            <Input value={titulo} maxLength={160} onChange={(evento) => setTitulo(evento.target.value)} />
          </label>
          {estrutura && (
            <>
              <label className="flex flex-col gap-1 text-sm">Projeto
                <Select value={projetoId} onChange={(evento) => { setProjetoId(evento.target.value); setCategoriaId(""); }}>
                  <option value="">Sem projeto</option>
                  {estrutura.projetos.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">Categoria
                <Select value={categoriaId} disabled={!projetoId} onChange={(evento) => setCategoriaId(evento.target.value)}>
                  <option value="">Sem categoria</option>
                  {categoriasDoProjeto.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                </Select>
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button size="sm" disabled={trabalhando || titulo.trim().length < 2} onClick={salvarEdicao}><Save aria-hidden="true" />Salvar</Button>
            <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => setEditando(false)}><X aria-hidden="true" />Cancelar</Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3" aria-live="polite">
        <MensagemDeErro>{erro}</MensagemDeErro>
        {mostrarDownloads && <PainelDownloads adminPath={adminPath} documentoId={documento.id} />}
        {podeExcluir && <div><ConfirmarExclusao aviso="O PDF e o registro serão apagados em definitivo. O cliente perde o acesso na hora." aoConfirmar={excluir} /></div>}
      </div>
    </li>
  );
}

function PainelDownloads({ adminPath, documentoId }: { adminPath: string; documentoId: string }) {
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [resultado, setResultado] = useState<{ registros: DownloadDocumento[]; proximaPagina: number | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    chamarPortal<{ registros: DownloadDocumento[]; proximaPagina: number | null }>(
      adminPath, `documentos/downloads?documentoId=${documentoId}&pagina=${pagina}`, "GET",
    ).then((resposta) => {
      if (!ativo) return;
      setCarregando(false);
      setErro(resposta.ok ? null : resposta.erro);
      if (resposta.ok && resposta.details) setResultado(resposta.details);
    });
    return () => { ativo = false; };
  }, [adminPath, documentoId, pagina]);

  function irPara(alvo: number) {
    setCarregando(true);
    setPagina(alvo);
  }

  return (
    <section aria-label="Downloads do documento" className="rounded-lg border bg-muted/40 p-3 text-sm">
      <MensagemDeErro>{erro}</MensagemDeErro>
      {resultado?.registros.length === 0 && <p className="text-muted-foreground">Ninguém baixou este documento ainda.</p>}
      {resultado && resultado.registros.length > 0 && (
        <ul className="flex flex-col gap-1">
          {resultado.registros.map((registro) => (
            <li key={registro.id} className="flex flex-wrap justify-between gap-2">
              <span className="min-w-0 break-words">{registro.nome ?? "Usuário removido"}</span>
              <span className="text-muted-foreground">{dataHora(registro.em)}{registro.origem ? ` · origem ${registro.origem}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {(pagina > 1 || resultado?.proximaPagina) && (
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="outline" disabled={carregando || pagina <= 1} onClick={() => irPara(pagina - 1)}>Anteriores</Button>
          <Button size="xs" variant="outline" disabled={carregando || !resultado?.proximaPagina} onClick={() => resultado?.proximaPagina && irPara(resultado.proximaPagina)}>Próximos</Button>
        </div>
      )}
    </section>
  );
}
