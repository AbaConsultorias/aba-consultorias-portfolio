"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";

type Props = { adminPath: string; ativo: boolean; ehAdmin: boolean };
type Etapa = "ocioso" | "emitir" | "revogar";

export function ChaveDoServidor({ adminPath, ativo, ehAdmin }: Props) {
  const router = useRouter();
  const campoDaChave = useRef<HTMLElement>(null);
  const [etapa, setEtapa] = useState<Etapa>("ocioso");
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [chave, setChave] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<boolean | null>(null);
  const [revogada, setRevogada] = useState(false);

  async function emitir() {
    setTrabalhando(true);
    setErro(null);
    const resposta = await chamarPortal<{ chave: string }>(adminPath, "conector", "POST", {});
    setTrabalhando(false);
    if (!resposta.ok || !resposta.details) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return;
    }
    setEtapa("ocioso");
    setRevogada(false);
    setCopiada(null);
    setChave(resposta.details.chave);
    router.refresh();
  }

  async function revogar() {
    setTrabalhando(true);
    setErro(null);
    const resposta = await chamarPortal(adminPath, "conector", "DELETE");
    setTrabalhando(false);
    if (!resposta.ok) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro);
      return;
    }
    setEtapa("ocioso");
    setChave(null);
    setRevogada(true);
    router.refresh();
  }

  async function copiar() {
    if (!chave) return;
    try {
      await navigator.clipboard.writeText(chave);
      setCopiada(true);
    } catch {
      // Alguns navegadores recusam a área de transferência: deixa a chave selecionada para copiar com Ctrl+C.
      const alvo = campoDaChave.current;
      if (alvo) window.getSelection()?.selectAllChildren(alvo);
      setCopiada(false);
    }
  }

  if (!ehAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Só quem tem o papel de administrador emite ou revoga a chave do servidor.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {chave && (
        <div role="alert" className="flex min-w-0 flex-col gap-2 rounded-lg border border-primary/50 p-3">
          <p className="text-sm font-medium">Chave nova. Ela aparece só agora: copie e guarde antes de sair desta tela.</p>
          <code ref={campoDaChave} className="block break-all rounded-md bg-muted p-2 text-sm select-all">{chave}</code>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={copiar}><Copy aria-hidden="true" />Copiar chave</Button>
            <Button size="sm" variant="outline" onClick={() => setChave(null)}>Já guardei a chave</Button>
            <span role="status" className="text-sm">
              {copiada === true && "Chave copiada."}
              {copiada === false && "Não foi possível copiar sozinho: a chave está selecionada, use Ctrl+C."}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Cole a chave no instalador do Conector no servidor. Depois de fechar este aviso, não há como vê-la de novo — só emitir outra.
          </p>
        </div>
      )}

      {revogada && <p role="status" className="text-sm">Chave revogada. O servidor não envia mais documentos.</p>}

      {etapa === "ocioso" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={trabalhando} onClick={() => setEtapa("emitir")}>
            <KeyRound aria-hidden="true" />{ativo ? "Emitir nova chave" : "Emitir chave"}
          </Button>
          {ativo && (
            <Button size="sm" variant="destructive" disabled={trabalhando} onClick={() => setEtapa("revogar")}>
              <Trash2 aria-hidden="true" />Revogar chave
            </Button>
          )}
        </div>
      )}

      {etapa === "emitir" && (
        <div role="alertdialog" aria-label="Confirmar emissão da chave" className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm">
            {ativo
              ? "Emitir uma nova chave revoga a atual. O servidor da empresa para de enviar documentos até receber a chave nova no instalador."
              : "Será criada a chave que o servidor da empresa usa para enviar documentos."}{" "}
            Continuar?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={trabalhando} aria-busy={trabalhando} onClick={emitir}>{trabalhando ? "Emitindo..." : "Sim, emitir"}</Button>
            <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => setEtapa("ocioso")}>Cancelar</Button>
          </div>
        </div>
      )}

      {etapa === "revogar" && (
        <div role="alertdialog" aria-label="Confirmar revogação da chave" className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
          <p className="text-sm">
            Revogar a chave faz o servidor da empresa parar de enviar documentos na hora. Para voltar, é preciso emitir outra chave e instalá-la no servidor.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={trabalhando} aria-busy={trabalhando} onClick={revogar}>{trabalhando ? "Revogando..." : "Sim, revogar"}</Button>
            <Button size="sm" variant="outline" disabled={trabalhando} onClick={() => setEtapa("ocioso")}>Cancelar</Button>
          </div>
        </div>
      )}

      <div aria-live="polite"><MensagemDeErro>{erro}</MensagemDeErro></div>
    </div>
  );
}
