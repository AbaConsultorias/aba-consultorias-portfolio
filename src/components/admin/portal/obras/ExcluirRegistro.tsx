"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { requisicao } from "@/components/portal/obras/requisicao";

export function ExcluirRegistro({ endpoint, id, rotulo, explicacao }: { endpoint: string; id: string; rotulo: string; explicacao: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  async function excluir() {
    setEnviando(true); setMensagem("");
    try { await requisicao(endpoint, "DELETE", { id }, z.object({ id: z.uuid() })); setConfirmando(false); router.refresh(); }
    catch (error) { setMensagem(error instanceof Error ? error.message : "Não foi possível concluir."); }
    finally { setEnviando(false); }
  }
  return <div>{confirmando ? <div className="space-y-3"><p className="text-sm">{explicacao}</p><div className="obras-acoes"><Button type="button" variant="destructive" disabled={enviando} onClick={excluir}><Check aria-hidden="true" />{enviando ? "Aguarde…" : "Confirmar"}</Button><Button type="button" variant="outline" disabled={enviando} onClick={() => setConfirmando(false)}><X aria-hidden="true" />Cancelar</Button></div></div> : <Button type="button" variant="destructive" onClick={() => setConfirmando(true)}><Trash2 aria-hidden="true" />{rotulo}</Button>}<p role="status" className="obras-mensagem">{mensagem}</p></div>;
}
