"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { requisitar } from "@/components/portal/fornecedor/formulario";
export function ExcluirFornecedorRegistro({ endpoint, id, rotulo, destino }: { endpoint: string; id: string; rotulo: string; destino?: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  async function excluir() {
    setOcupado(true); setErro("");
    try { await requisitar(endpoint, "DELETE", z.object({ id: z.uuid() }).parse({ id })); setConfirmando(false); if (destino) router.push(destino); router.refresh(); }
    catch (error) { setErro(error instanceof Error ? error.message : "Não foi possível excluir."); }
    finally { setOcupado(false); }
  }
  return <div className="mt-4"><div className="forn-linha">{confirmando ? <><span>Confirma {rotulo.toLowerCase()}?</span><Button variant="destructive" disabled={ocupado} onClick={excluir}><Check aria-hidden="true" />Confirmar</Button><Button variant="outline" disabled={ocupado} onClick={() => setConfirmando(false)}><X aria-hidden="true" />Cancelar</Button></> : <Button variant="destructive" onClick={() => setConfirmando(true)}><Trash2 aria-hidden="true" />{rotulo}</Button>}</div><p className="forn-mensagem" role="alert">{erro}</p></div>;
}
