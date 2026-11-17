"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { MAXIMO_LOTE } from "@/lib/portal/conector/fila";
import { resumirLote, type ResultadoLoteDocumentos } from "@/lib/portal/documentos/lote";
import { chamarPortal } from "./api";

type Acao = "liberar" | "ocultar";

// A seleção vale só para a página aberta: o que sumiu da página (outra página, documento apagado) não entra na contagem nem no envio.
export function useSelecaoEmLote(adminPath: string, idsDaPagina: readonly string[]) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [confirmando, setConfirmando] = useState<Acao | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);

  const selecionados = idsDaPagina.filter((id) => marcados.has(id));

  function mudar(proximo: ReadonlySet<string>) {
    setMarcados(proximo);
    setConfirmando(null);
    setResumo(null);
    setErro(null);
  }

  function alternar(id: string) {
    const proximo = new Set(selecionados);
    if (!proximo.delete(id) && proximo.size < MAXIMO_LOTE) proximo.add(id);
    mudar(proximo);
  }

  function alternarVarios(ids: readonly string[]) {
    const proximo = new Set(selecionados);
    if (ids.every((id) => proximo.has(id))) {
      for (const id of ids) proximo.delete(id);
    } else {
      for (const id of ids) if (proximo.size < MAXIMO_LOTE) proximo.add(id);
    }
    mudar(proximo);
  }

  async function aplicar(acao: Acao) {
    const liberado = acao === "liberar";
    setTrabalhando(true);
    setErro(null);
    setResumo(null);
    const resposta = await chamarPortal<ResultadoLoteDocumentos>(adminPath, "documentos/lote", "POST", { ids: selecionados, liberado });
    setTrabalhando(false);
    setConfirmando(null);
    if (!resposta.ok || !resposta.details) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return;
    }
    setResumo(resumirLote(resposta.details, liberado));
    setMarcados(new Set());
    router.refresh();
  }

  return {
    marcados,
    quantidade: selecionados.length,
    confirmando,
    trabalhando,
    erro,
    resumo,
    alternar,
    alternarVarios,
    limpar: () => mudar(new Set()),
    pedirConfirmacao: setConfirmando,
    aplicar,
  };
}

export type SelecaoEmLote = ReturnType<typeof useSelecaoEmLote>;

export function CaixaDoDocumento({ selecao, id, titulo }: { selecao: SelecaoEmLote; id: string; titulo: string }) {
  return (
    <label className="flex size-10 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" className="size-5" aria-label={`Selecionar ${titulo}`}
        checked={selecao.marcados.has(id)} disabled={selecao.trabalhando} onChange={() => selecao.alternar(id)} />
    </label>
  );
}

type PropsSelecionarTodos = { selecao: SelecaoEmLote; ids: readonly string[]; rotulo: string; descricao: string };

export function SelecionarTodos({ selecao, ids, rotulo, descricao }: PropsSelecionarTodos) {
  const ref = useRef<HTMLInputElement>(null);
  const marcadosNoGrupo = ids.filter((id) => selecao.marcados.has(id)).length;
  const todos = ids.length > 0 && marcadosNoGrupo === ids.length;
  const parcial = marcadosNoGrupo > 0 && !todos;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = parcial;
  }, [parcial]);

  if (ids.length === 0) return null;
  return (
    <label className="flex min-h-10 w-fit max-w-full cursor-pointer items-center gap-2 text-sm">
      <input ref={ref} type="checkbox" className="size-5 shrink-0" aria-label={descricao}
        checked={todos} disabled={selecao.trabalhando} onChange={() => selecao.alternarVarios(ids)} />
      <span className="min-w-0">{rotulo}</span>
    </label>
  );
}

const TEXTO: Record<Acao, { pergunta: (quantidade: number) => string; rotulo: string; ocupado: string }> = {
  liberar: {
    pergunta: (quantidade) => `Liberar ${quantidade} documento(s) para o cliente? Quando for uma revisão, a versão anterior deixa de aparecer para o cliente.`,
    rotulo: "Sim, liberar",
    ocupado: "Liberando...",
  },
  ocultar: {
    pergunta: (quantidade) => `Ocultar ${quantidade} documento(s)? O cliente deixa de ver esses arquivos.`,
    rotulo: "Sim, ocultar",
    ocupado: "Ocultando...",
  },
};

export function BarraAcoesEmLote({ selecao }: { selecao: SelecaoEmLote }) {
  const idConfirmacao = useId();
  const { quantidade, confirmando, trabalhando } = selecao;

  return (
    <section aria-label="Ações em lote" className="sticky top-0 z-10 flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 text-sm font-medium">{quantidade} selecionado(s)</p>
        <Button className="portal-botao" disabled={trabalhando || quantidade === 0} onClick={() => selecao.pedirConfirmacao("liberar")}>
          <Eye aria-hidden="true" />Liberar selecionados ({quantidade})
        </Button>
        <Button className="portal-botao" variant="outline" disabled={trabalhando || quantidade === 0} onClick={() => selecao.pedirConfirmacao("ocultar")}>
          <EyeOff aria-hidden="true" />Ocultar selecionados ({quantidade})
        </Button>
        <Button className="portal-botao" variant="outline" disabled={trabalhando || quantidade === 0} onClick={selecao.limpar}>
          <X aria-hidden="true" />Limpar seleção
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">A seleção vale só para os documentos desta página.</p>

      {confirmando && (
        <div role="alertdialog" aria-label={confirmando === "liberar" ? "Confirmar liberação" : "Confirmar ocultação"} aria-describedby={idConfirmacao}
          className="flex flex-col gap-2 rounded-lg border p-3">
          <p id={idConfirmacao} className="text-sm">{TEXTO[confirmando].pergunta(quantidade)}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="portal-botao" disabled={trabalhando} aria-busy={trabalhando} onClick={() => selecao.aplicar(confirmando)}>
              {trabalhando ? TEXTO[confirmando].ocupado : TEXTO[confirmando].rotulo}
            </Button>
            <Button className="portal-botao" variant="outline" disabled={trabalhando} onClick={() => selecao.pedirConfirmacao(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <MensagemDeErro>{selecao.erro}</MensagemDeErro>
      <p role="status" className="min-w-0 break-words text-sm empty:hidden">{selecao.resumo}</p>
    </section>
  );
}
