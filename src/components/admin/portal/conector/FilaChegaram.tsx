"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Ban, ExternalLink, Eye, FileText, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { dataHoraSaoPaulo, dataSaoPaulo } from "@/lib/portal/conector/formato";
import { MAXIMO_LOTE, type ItemFila, type ResultadoLote } from "@/lib/portal/conector/fila";
import { formatarTamanho } from "@/lib/portal/documentos/regras";

type Props = {
  adminPath: string;
  itens: ItemFila[];
  hrefAnterior: string | null;
  hrefProxima: string | null;
};

const NOTA_IGNORAR = "Ignorar tira o documento da fila sem apagar e sem liberar: ele continua oculto para o cliente.";

function resumir(resultado: ResultadoLote): string {
  const partes = [`${resultado.liberados.length} liberado(s)`];
  if (resultado.ignorados.length > 0) partes.push(`${resultado.ignorados.length} não liberado(s): ${[...new Set(resultado.ignorados.map((item) => item.motivo))].join(" ")}`);
  if (resultado.falhas.length > 0) partes.push(`${resultado.falhas.length} com falha (tente de novo)`);
  return partes.join(" · ");
}

export function FilaChegaram({ adminPath, itens, hrefAnterior, hrefProxima }: Props) {
  const router = useRouter();
  const notaIgnorar = useId();
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const [confirmando, setConfirmando] = useState<"liberar" | "ignorar" | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const todos = itens.length > 0 && itens.every((item) => selecionados.has(item.id));
  const quantidade = itens.filter((item) => selecionados.has(item.id)).length;

  function alternar(id: string) {
    const proximo = new Set(selecionados);
    if (!proximo.delete(id)) proximo.add(id);
    setSelecionados(proximo);
    setConfirmando(null);
  }

  function alternarTodos() {
    setSelecionados(todos ? new Set() : new Set(itens.slice(0, MAXIMO_LOTE).map((item) => item.id)));
    setConfirmando(null);
  }

  async function ignorar(ids: string[]) {
    setTrabalhando(true);
    setErro(null);
    setAviso(null);
    const resposta = await chamarPortal<{ ignorados: string[] }>(adminPath, "conector/chegaram/ignorar", "POST", { ids });
    setTrabalhando(false);
    setConfirmando(null);
    if (!resposta.ok || !resposta.details) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return;
    }
    setAviso(`${resposta.details.ignorados.length} documento(s) tirado(s) da fila.`);
    setSelecionados(new Set());
    router.refresh();
  }

  async function liberar(ids: string[]) {
    setTrabalhando(true);
    setErro(null);
    setAviso(null);
    const resposta = await chamarPortal<ResultadoLote>(adminPath, "conector/chegaram", "POST", { ids });
    setTrabalhando(false);
    setConfirmando(null);
    if (!resposta.ok || !resposta.details) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return;
    }
    setAviso(resumir(resposta.details));
    setSelecionados(new Set());
    router.refresh();
  }

  if (itens.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-medium">Nada esperando liberação</h2>
        <p className="mt-1 text-sm text-muted-foreground">Os PDFs que o servidor da empresa enviar aparecem aqui, ocultos, até você liberar.</p>
        <p role="status" className="mt-3 text-sm">{aviso}</p>
        {hrefAnterior && <Button asChild variant="outline" className="portal-botao mt-3"><Link href={hrefAnterior} prefetch={false}><ArrowLeft size={18} aria-hidden="true" />Voltar à página anterior</Link></Button>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={todos} onChange={alternarTodos} />
          Selecionar todos desta página
        </label>
        <Button size="sm" disabled={trabalhando || quantidade === 0} onClick={() => setConfirmando("liberar")}>
          <Eye aria-hidden="true" />Liberar selecionados ({quantidade})
        </Button>
        <Button size="sm" variant="outline" disabled={trabalhando || quantidade === 0} aria-describedby={notaIgnorar} onClick={() => setConfirmando("ignorar")}>
          <Ban aria-hidden="true" />Ignorar selecionados ({quantidade})
        </Button>
        <p id={notaIgnorar} className="min-w-0 basis-full text-xs text-muted-foreground">{NOTA_IGNORAR}</p>
      </div>

      {confirmando === "ignorar" && (
        <div role="alertdialog" aria-label="Confirmar ignorar" className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm">
            Tirar {quantidade} documento(s) da fila? Eles continuam ocultos para o cliente e guardados no portal.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={trabalhando} aria-busy={trabalhando} onClick={() => ignorar(itens.filter((item) => selecionados.has(item.id)).map((item) => item.id))}>
              {trabalhando ? "Tirando..." : "Sim, ignorar"}
            </Button>
            <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => setConfirmando(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      {confirmando === "liberar" && (
        <div role="alertdialog" aria-label="Confirmar liberação" className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm">
            Liberar {quantidade} documento(s) para o cliente? Quando for uma revisão, a versão anterior deixa de aparecer para o cliente.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={trabalhando} aria-busy={trabalhando} onClick={() => liberar(itens.filter((item) => selecionados.has(item.id)).map((item) => item.id))}>
              {trabalhando ? "Liberando..." : "Sim, liberar"}
            </Button>
            <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => setConfirmando(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        <MensagemDeErro>{erro}</MensagemDeErro>
        {aviso && <p role="status" className="text-sm">{aviso}</p>}
      </div>

      <ul className="flex flex-col gap-3">
        {itens.map((item) => (
          <li key={item.id} className="portal-entrada rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start gap-3">
              <input type="checkbox" className="mt-1 size-5 shrink-0" aria-label={`Selecionar ${item.titulo}`}
                checked={selecionados.has(item.id)} onChange={() => alternar(item.id)} />
              <FileText size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 basis-60">
                <p className="break-words font-medium">{item.titulo}</p>
                {item.equipamento && <p className="mt-1"><span className="inline-flex rounded-full border px-3 py-1 text-xs">{item.equipamento}</span></p>}
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {[item.empreendimentoNome ?? "Empreendimento não encontrado", item.destino, formatarTamanho(item.tamanho), `Chegou em ${dataSaoPaulo(item.criadoEm)}`].join(" · ")}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  <span className="font-medium">Origem no servidor (só a equipe vê):</span> {item.origem}
                </p>
                {item.revisao && (
                  <p className="mt-2 flex min-w-0 items-start gap-2 break-words rounded-lg border bg-muted/40 p-2 text-sm">
                    <History size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      {item.revisao.visivel
                        ? <>Revisão. O cliente vê hoje “{item.revisao.visivel.titulo}”{item.revisao.visivel.liberadoEm ? `, liberado em ${dataHoraSaoPaulo(item.revisao.visivel.liberadoEm)}` : ""}. Ao liberar, essa versão deixa de aparecer.</>
                        : <>Revisão de um arquivo que o cliente ainda não vê (a versão anterior está oculta).</>}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={trabalhando} aria-busy={trabalhando} onClick={() => liberar([item.id])}
                  aria-label={`${item.revisao ? "Liberar revisão" : "Liberar"}: ${item.titulo}`}>
                  <Eye aria-hidden="true" />{item.revisao ? "Liberar revisão" : "Liberar"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={item.downloadHref} target="_blank" rel="noopener" aria-label={`Abrir ${item.titulo} (nova aba)`}><ExternalLink aria-hidden="true" />Abrir</a>
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {(hrefAnterior || hrefProxima) && (
        <nav aria-label="Paginação" className="flex justify-between gap-3">
          {hrefAnterior ? <Button asChild variant="outline" className="portal-botao"><Link href={hrefAnterior} prefetch={false}><ArrowLeft size={18} aria-hidden="true" />Anteriores</Link></Button> : <span />}
          {hrefProxima && <Button asChild variant="outline" className="portal-botao"><Link href={hrefProxima} prefetch={false}>Próximos<ArrowRight size={18} aria-hidden="true" /></Link></Button>}
        </nav>
      )}
    </div>
  );
}
