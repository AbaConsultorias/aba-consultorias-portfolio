"use client";
import { useState } from "react";
import z from "zod";
import Image from "next/image";
import { urlPublica } from "@/lib/conteudo/url";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { enviarArquivo, type DadosDoEnvio } from "@/components/admin/comum/cliente-api";
export function ArquivoCampo({ id, adminPath, destino, donoId, video, value, onChange, onUpload, onOcupado, disabled }: {
    id: string;
    adminPath: string;
    destino: string;
    donoId?: string;
    video?: boolean;
    value: string | null;
    onChange: (path: string | null) => void;
    onUpload: (path: string) => void;
    onOcupado: (ocupado: boolean) => void;
    disabled?: boolean;
}) {
    const [ocupado, setOcupado] = useState(false);
    const [progresso, setProgresso] = useState<number | null>(null);
    const [erro, setErro] = useState("");
    const precisaDono = destino === "portfolio" && !donoId;
    const arquivoUrl = value ? urlPublica(value) : null;
    async function enviar(file?: File) {
        if (!file)
            return;
        setErro("");
        setOcupado(true);
        onOcupado(true);
        try {
            if (file.size > (video ? 15 : 10) * 1024 * 1024)
                throw new Error(video ? "O vídeo deve ter até 15 MB." : "A imagem deve ter até 10 MB.");
            const envio = await enviarArquivo(adminPath, { destino: destino as DadosDoEnvio["destino"], tipo: video ? "video" : "imagem", donoId }, file, setProgresso);
            if (!envio.ok)
                throw new Error(envio.erro ?? "Não foi possível enviar o arquivo.");
            const path = z.string().parse(envio.details?.path);
            onUpload(path);
            onChange(path);
        }
        catch (error) {
            setErro(error instanceof Error ? error.message : "Não foi possível enviar o arquivo.");
        }
        finally {
            setProgresso(null);
            setOcupado(false);
            onOcupado(false);
        }
    }
    return <div className="min-w-0 space-y-2">
  <Input id={id} type="file" disabled={disabled || ocupado || precisaDono} accept={video ? "video/mp4" : "image/jpeg,image/png,image/webp"} onChange={event => {
        void enviar(event.target.files?.[0]);
        event.target.value = "";
    }}/>
  <p className="text-xs text-muted-foreground">{precisaDono ? "Salve o projeto primeiro para habilitar o envio." : video ? "MP4 vertical, até 15 MB (720p ou comprimido)." : "JPEG, PNG ou WebP, até 10 MB."}</p>
  {arquivoUrl && <div className="space-y-2">
    {!value?.toLowerCase().endsWith(".mp4") && <Image src={arquivoUrl} alt="Prévia da imagem enviada" width={320} height={180} className="max-h-44 w-auto max-w-full rounded-md border object-contain"/>}
    <div className="flex min-w-0 flex-wrap items-center gap-3"><a href={arquivoUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline focus-visible:outline-2 focus-visible:outline-ring">Abrir arquivo atual<span className="sr-only"> (abre em nova aba)</span></a><Button type="button" variant="outline" size="sm" disabled={disabled || ocupado} onClick={() => onChange(null)}>Remover do registro</Button></div>
  </div>}
  {ocupado && <p role="status">Enviando arquivo…{progresso !== null && ` ${Math.round(progresso * 100)}%`}</p>}{erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
 </div>;
}
