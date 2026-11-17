"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { urlPublica } from "@/lib/conteudo/url";
import { sanitizarSvg } from "@/lib/svg/sanitizar";
import { MensagemDeErro } from "./campos";
import { apagarArquivoEnviado, enviarArquivo, type DadosDoEnvio } from "./cliente-api";
import { PreviaSvg } from "./PreviaSvg";

const MB = 1024 * 1024;

export const REGRAS_DE_ARQUIVO = {
  imagem: { accept: "image/jpeg,image/png,image/webp", limite: 10 * MB, dica: "JPEG, PNG ou WebP, até 10 MB." },
  video: { accept: "video/mp4", limite: 15 * MB, dica: "MP4 vertical, até 15 MB (720p ou comprimido)." },
  mapa: { accept: "image/svg+xml,.svg", limite: 2 * MB, dica: "SVG, até 2 MB." },
} as const;

export function PreviaDeArquivo({
  tipo,
  path,
  rotulo,
}: {
  tipo: DadosDoEnvio["tipo"];
  path: string;
  rotulo: string;
}) {
  const url = urlPublica(path);

  if (tipo === "mapa") return <PreviaSvg url={url} rotulo={rotulo} />;
  if (tipo === "video") {
    return <video src={url} controls preload="metadata" className="max-h-56 max-w-full rounded-lg bg-black" />;
  }
  return (
    <Image
      src={url}
      alt={rotulo}
      width={480}
      height={320}
      unoptimized
      className="h-auto max-h-56 w-auto max-w-full rounded-lg border border-border object-contain"
    />
  );
}

type Props = {
  adminPath: string;
  destino: DadosDoEnvio["destino"];
  tipo: DadosDoEnvio["tipo"];
  donoId?: string;
  rotulo: string;
  dica?: string;
  valor: string | null;
  // Grava o novo caminho (ou null para remover) no registro. Devolve a mensagem
  // de erro, ou null quando salvou; se falhar, o arquivo recém-enviado é apagado.
  aoAlterar: (path: string | null) => Promise<string | null>;
};

export function CampoUpload({ adminPath, destino, tipo, donoId, rotulo, dica, valor, aoAlterar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [trabalhando, setTrabalhando] = useState<"enviando" | "removendo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  // Texto do arquivo escolhido; só é injetado depois de passar pelo limpador.
  const [mapaLocal, setMapaLocal] = useState<string | null>(null);
  const mapaLocalLimpo = useMemo(() => (mapaLocal === null ? null : sanitizarSvg(mapaLocal)), [mapaLocal]);
  const regras = REGRAS_DE_ARQUIVO[tipo];

  async function escolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;

    setErro(null);
    if (arquivo.size > regras.limite) {
      setErro(`O arquivo passa do limite. ${regras.dica}`);
      return;
    }

    let previa: string | null = null;
    if (tipo === "mapa") {
      previa = await arquivo.text();
      if (!sanitizarSvg(previa)) {
        setErro("O arquivo não é um mapa SVG válido ou não tem nenhum desenho.");
        return;
      }
    }

    setTrabalhando("enviando");
    setProgresso(null);
    const envio = await enviarArquivo(adminPath, { destino, tipo, donoId }, arquivo, setProgresso);
    setProgresso(null);
    if (!envio.ok || !envio.details) {
      setTrabalhando(null);
      setErro(envio.erro ?? envio.erros.arquivo ?? "Não foi possível enviar o arquivo.");
      return;
    }

    const novoPath = envio.details.path;
    const falha = await aoAlterar(novoPath);
    setTrabalhando(null);

    if (falha) {
      await apagarArquivoEnviado(adminPath, novoPath);
      setErro(falha);
      return;
    }
    setMapaLocal(previa);
  }

  async function remover() {
    setTrabalhando("removendo");
    setErro(null);
    const falha = await aoAlterar(null);
    setTrabalhando(null);
    if (falha) setErro(falha);
    else setMapaLocal(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{rotulo}</span>

      {valor && (
        <div className="flex flex-col gap-2">
          {tipo === "mapa" && mapaLocalLimpo ? (
            <div
              role="img"
              aria-label={rotulo}
              className="max-h-72 overflow-hidden rounded-lg border border-border bg-muted p-2 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-64 [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: mapaLocalLimpo }}
            />
          ) : (
            <PreviaDeArquivo tipo={tipo} path={valor} rotulo={rotulo} />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={entrada}
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept={regras.accept}
          className="sr-only"
          disabled={trabalhando !== null}
          onChange={escolher}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${valor ? "Trocar" : "Escolher"} arquivo: ${rotulo}`}
          disabled={trabalhando !== null}
          onClick={() => entrada.current?.click()}
        >
          <ImageUp aria-hidden="true" />
          {trabalhando === "enviando"
            ? `Enviando${progresso === null ? "..." : ` ${Math.round(progresso * 100)}%`}`
            : valor
              ? "Trocar arquivo"
              : "Escolher arquivo"}
        </Button>
        {valor && (
          <Button type="button" variant="ghost" size="sm" disabled={trabalhando !== null} onClick={remover}>
            <Trash2 aria-hidden="true" />
            {trabalhando === "removendo" ? "Removendo..." : "Remover"}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{dica ?? regras.dica}</span>
      </div>
      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}
