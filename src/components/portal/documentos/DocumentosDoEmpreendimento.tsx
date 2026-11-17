"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileText, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatarTamanho, projetoDoHash } from "@/lib/portal/documentos/regras";
import type { CartaoDeDocumentos, PainelDeDocumentos } from "@/lib/portal/documentos/painel";
import type { DocumentoPortal } from "@/lib/portal/documentos/tipos";
import { SecaoSimosLaudos } from "./SecaoSimosLaudos";
import "./documentos.css";

const VISIVEIS_POR_CATEGORIA = 5;
const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const plural = (n: number) => `${n} ${n === 1 ? "documento" : "documentos"}`;

// Com busca, cada cartão fica só com os documentos cujo nome (ou equipamento) contém o termo.
function filtrar(cartao: CartaoDeDocumentos, termo: string): CartaoDeDocumentos | null {
  if (!termo) return cartao;
  const casa = (documento: DocumentoPortal) => semAcento(`${documento.titulo} ${documento.equipamento ?? ""}`).includes(termo);
  const categorias = cartao.categorias.map((categoria) => ({ ...categoria, documentos: categoria.documentos.filter(casa) })).filter((categoria) => categoria.documentos.length > 0);
  const equipamentos = cartao.equipamentos.filter(casa);
  const total = categorias.reduce((soma, categoria) => soma + categoria.documentos.length, 0) + equipamentos.length;
  return total ? { ...cartao, categorias, equipamentos, total } : null;
}

export function DocumentosDoEmpreendimento({ empreendimentoId, painel, cortado }: { empreendimentoId: string; painel: PainelDeDocumentos; cortado: boolean }) {
  const [busca, setBusca] = useState("");
  const termo = semAcento(busca.trim());
  const visiveis = useMemo(() => ({
    projetos: painel.projetos.flatMap((cartao) => filtrar(cartao, termo) ?? []),
    contratacao: painel.contratacao.flatMap((cartao) => filtrar(cartao, termo) ?? []),
    outros: painel.outros.flatMap((cartao) => filtrar(cartao, termo) ?? []),
    gerais: painel.gerais ? filtrar(painel.gerais, termo) : null,
  }), [painel, termo]);
  const total = [...painel.projetos, ...painel.contratacao, ...painel.outros, ...(painel.gerais ? [painel.gerais] : [])].reduce((soma, cartao) => soma + cartao.total, 0);
  const encontrados = [...visiveis.projetos, ...visiveis.contratacao, ...visiveis.outros, ...(visiveis.gerais ? [visiveis.gerais] : [])].reduce((soma, cartao) => soma + cartao.total, 0);

  if (total === 0) {
    return (
      <section className="portal-vazio">
        <h2>Nenhum documento disponível</h2>
        <p>Quando a equipe liberar plantas, contratos e outros PDFs do seu empreendimento, eles aparecerão aqui.</p>
      </section>
    );
  }

  const cartao = (item: CartaoDeDocumentos) => <Cartao key={item.chave} cartao={item} empreendimentoId={empreendimentoId} buscando={termo !== ""} />;
  return (
    <div className="portal-docs">
      <div className="portal-docs-barra">
        <div className="portal-docs-busca">
          <label htmlFor="busca-documentos" className="sr-only">Buscar documento pelo nome</label>
          <Search size={18} aria-hidden="true" />
          <input id="busca-documentos" type="search" value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Buscar documento pelo nome" autoComplete="off" />
        </div>
        <p role="status" aria-live="polite" className="portal-docs-nota">{termo ? `${plural(encontrados)} de ${total}` : plural(total)}</p>
      </div>
      {cortado && <p className="portal-docs-nota">Mostrando os {plural(total)} mais recentes. Se não encontrar um arquivo antigo, peça à equipe.</p>}

      {termo && encontrados === 0 ? (
        <section className="portal-vazio portal-docs-sem-resultado">
          <SearchX size={28} aria-hidden="true" />
          <h2>Nada encontrado</h2>
          <p>Nenhum documento tem “{busca.trim()}” no nome.</p>
          <Button type="button" variant="outline" className="portal-botao" onClick={() => setBusca("")}>Limpar busca</Button>
        </section>
      ) : (
        <>
          {visiveis.projetos.length > 0 && (
            <section className="portal-docs-bloco" aria-labelledby="docs-projetos">
              <h2 id="docs-projetos" className="portal-docs-titulo-bloco">Projetos</h2>
              {visiveis.projetos.map(cartao)}
            </section>
          )}
          {visiveis.contratacao.length > 0 && (
            <section className="portal-docs-bloco" aria-labelledby="docs-contratacao">
              <h2 id="docs-contratacao" className="portal-docs-titulo-bloco">Documentos da contratação</h2>
              {visiveis.contratacao.map(cartao)}
            </section>
          )}
          {visiveis.outros.length > 0 && (
            <section className="portal-docs-bloco" aria-labelledby="docs-outros-projetos">
              <h2 id="docs-outros-projetos" className="portal-docs-titulo-bloco">Outros projetos</h2>
              {visiveis.outros.map(cartao)}
            </section>
          )}
          {visiveis.gerais && <section className="portal-docs-bloco" aria-label="Outros documentos">{cartao(visiveis.gerais)}</section>}
        </>
      )}
    </div>
  );
}

function Cartao({ cartao, empreendimentoId, buscando }: { cartao: CartaoDeDocumentos; empreendimentoId: string; buscando: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // O rótulo de "Outros projetos" tem espaços e acentos: o id só leva letras e números, para a âncora #id funcionar.
  const id = cartao.projetoId ? `projeto-${cartao.projetoId}` : `documentos-${cartao.chave.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-zA-Z0-9]+/g, "-")}`;

  // Na busca, todo cartão com resultado abre; ao limpar, voltam a ficar fechados.
  useEffect(() => {
    if (ref.current) ref.current.open = buscando;
  }, [buscando]);

  // A âncora #projeto-<id> (vinda da aba Projetos) abre e mostra o cartão correspondente.
  useEffect(() => {
    function abrirAncora() {
      const corresponde = cartao.projetoId ? projetoDoHash(window.location.hash) === cartao.projetoId : window.location.hash === `#${id}`;
      if (!corresponde || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start", behavior: "instant" });
    }
    abrirAncora();
    window.addEventListener("hashchange", abrirAncora);
    return () => window.removeEventListener("hashchange", abrirAncora);
  }, [id, cartao.projetoId]);

  const titulo = cartao.categorias.length === 1 && cartao.categorias[0].nome === null && !cartao.equipamentos.length;
  return (
    <details ref={ref} id={id} className={`portal-docs-projeto${cartao.nivel > 0 ? " portal-docs-dependente" : ""}`} data-nivel={cartao.nivel}>
      <summary className="portal-docs-resumo">
        <span className="portal-docs-cabecalho">
          <span className="portal-docs-nome" role="heading" aria-level={3}>{cartao.nome}</span>
          {cartao.dependeDe && <span className="portal-docs-depende">Depende de {cartao.dependeDe}</span>}
          <span className="portal-docs-selos">
            {cartao.etapa && <span className="portal-selo" data-tom={cartao.etapa.tom}><span className="sr-only">Etapa atual: </span>{cartao.etapa.nome}</span>}
            <span className="portal-docs-contagem">{plural(cartao.total)}</span>
          </span>
        </span>
        <ChevronDown className="portal-docs-chevron" size={20} aria-hidden="true" />
      </summary>
      <div className="portal-docs-conteudo">
        {cartao.categorias.map((categoria) => (
          <Categoria key={categoria.chave} nome={titulo ? null : categoria.nome ?? "Sem categoria"} documentos={categoria.documentos} rotulo={categoria.nome ?? cartao.nome} buscando={buscando} />
        ))}
        <SecaoSimosLaudos empreendimentoId={empreendimentoId} documentos={cartao.equipamentos} />
      </div>
    </details>
  );
}

function Categoria({ nome, documentos, rotulo, buscando }: { nome: string | null; documentos: DocumentoPortal[]; rotulo: string; buscando: boolean }) {
  const [todos, setTodos] = useState(false);
  const mostrar = todos || buscando ? documentos : documentos.slice(0, VISIVEIS_POR_CATEGORIA);
  const restantes = documentos.length - mostrar.length;
  return (
    <section className="portal-docs-grupo" aria-label={rotulo}>
      {nome && <h4>{nome} <span className="portal-docs-grupo-total">· {documentos.length}</span></h4>}
      <ul className="portal-docs-lista portal-docs-compacta">
        {mostrar.map((documento) => (
          <li key={documento.id} className="portal-doc">
            <span className="portal-doc-icone"><FileText size={22} aria-hidden="true" /></span>
            <div className="portal-doc-texto">
              <p className="portal-doc-titulo">{documento.titulo}</p>
              <p className="portal-doc-meta">PDF · {formatarTamanho(documento.tamanho)}{documento.liberadoEm ? ` · Disponível desde ${data(documento.liberadoEm)}` : ""}</p>
            </div>
            <Button asChild variant="outline" className="portal-botao portal-doc-baixar">
              <a href={documento.downloadHref} aria-label={`Baixar ${documento.titulo}`}><Download size={18} aria-hidden="true" /><span className="portal-doc-baixar-texto">Baixar</span></a>
            </Button>
          </li>
        ))}
      </ul>
      {restantes > 0 && (
        <Button type="button" variant="ghost" className="portal-botao portal-docs-mais" onClick={() => setTodos(true)}>
          Ver mais {restantes} {restantes === 1 ? "documento" : "documentos"}
        </Button>
      )}
    </section>
  );
}
