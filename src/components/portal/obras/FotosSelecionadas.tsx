"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function Previa({ arquivo }: { arquivo: File }) {
  // O endereço é criado uma vez por foto e liberado assim que a imagem carrega (ou falha).
  const [url] = useState(() => URL.createObjectURL(arquivo));
  const [falhou, setFalhou] = useState(false);
  return <div className="obras-previa">{!falhou
    // A prévia é local e não passa pelo otimizador de imagens.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt={`Prévia de ${arquivo.name}`} width={240} height={180} onLoad={() => URL.revokeObjectURL(url)} onError={() => { URL.revokeObjectURL(url); setFalhou(true); }} />
    : <span className="p-3 text-center text-xs">Prévia indisponível. O original será enviado.</span>}</div>;
}
export function FotosSelecionadas({ arquivos, estados, bloqueado, remover }: { arquivos: File[]; estados: string[]; bloqueado: boolean; remover: (indice: number) => void }) {
  return <div className="obras-fotos">{arquivos.map((arquivo, indice) => <figure key={`${arquivo.name}-${arquivo.lastModified}-${indice}`}>
    <Previa arquivo={arquivo} /><figcaption>{arquivo.name}<span className="block" aria-live="polite">{estados[indice] ?? "Pronta para enviar"}</span></figcaption>
    <Button type="button" variant="destructive" className="portal-botao" disabled={bloqueado} onClick={() => remover(indice)} aria-label={`Remover ${arquivo.name}`}><Trash2 size={18} aria-hidden="true" />Remover</Button>
  </figure>)}</div>;
}
