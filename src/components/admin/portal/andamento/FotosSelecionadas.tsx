"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { TIPOS_FOTO, erroDoArquivo, type FotoSelecionada, type EstadoFoto } from "./uploadFoto";

const ESTADOS: Record<EstadoFoto, string> = {
  aguardando: "Aguardando envio", autorizando: "Autorizando envio…", enviando: "Enviando arquivo…",
  confirmando: "Conferindo e confirmando foto…", concluida: "Foto confirmada", erro: "Falha no envio",
};

function Previa({ arquivo }: { arquivo: File }) {
  const img = useRef<HTMLImageElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(arquivo);
    if (img.current) img.current.src = url;
    if (link.current) link.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);
  return <div>
    {falhou ? <div className="flex h-28 w-full items-center justify-center rounded-md bg-muted p-3 text-center text-xs">Prévia indisponível neste navegador.</div>
      // A prévia usa somente um blob local, sem upload ou cache de imagens privadas.
      // eslint-disable-next-line @next/next/no-img-element
      : <img ref={img} width={160} height={112} alt={`Prévia de ${arquivo.name}`} className="h-28 w-full rounded-md object-cover" onError={() => setFalhou(true)} />}
    <Button asChild variant="outline" size="sm" className="mt-2"><a ref={link} download={arquivo.name}><Download aria-hidden="true" />Baixar original selecionado</a></Button>
  </div>;
}

export function FotosSelecionadas({ fotos, aoAlterar, bloqueado, rascunhoCriado }: {
  fotos: FotoSelecionada[]; aoAlterar: (fotos: FotoSelecionada[]) => void; bloqueado: boolean; rascunhoCriado: boolean;
}) {
  return <div className="space-y-4">
    <Field><FieldLabel htmlFor="nova-atualizacao-fotos">Fotos (opcional)</FieldLabel>
      <Input id="nova-atualizacao-fotos" type="file" multiple accept={TIPOS_FOTO} disabled={bloqueado || rascunhoCriado} aria-describedby="limites-fotos" onChange={(event) => {
        const novas: FotoSelecionada[] = [];
        for (const arquivo of Array.from(event.target.files ?? [])) {
          const erro = erroDoArquivo(arquivo);
          novas.push({ id: crypto.randomUUID(), arquivo, estado: erro ? "erro" : "aguardando", erro: erro ?? undefined });
        }
        aoAlterar([...fotos, ...novas]);
        event.target.value = "";
      }} />
      <p id="limites-fotos" className="text-sm text-muted-foreground">JPEG, PNG, WebP, HEIC ou HEIF, até 10 MiB por foto. Você pode selecionar vários arquivos e remover antes de salvar.</p>
    </Field>
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fotos.map((foto) => <li key={foto.id} className="min-w-0 space-y-2 rounded-lg border p-3">
      {!erroDoArquivo(foto.arquivo) && <Previa arquivo={foto.arquivo} />}
      <p className="break-all text-sm font-medium">{foto.arquivo.name}</p>
      <p role="status" className="text-sm">{ESTADOS[foto.estado]}</p>
      {foto.erro && <p className="text-sm text-destructive">{foto.erro}</p>}
      {!bloqueado && (!rascunhoCriado || foto.estado === "erro") && <Button type="button" variant="destructive" size="sm" aria-label={`Remover ${foto.arquivo.name}`} onClick={() => aoAlterar(fotos.filter((item) => item.id !== foto.id))}><Trash2 aria-hidden="true" />Remover</Button>}
    </li>)}</ul>
  </div>;
}
