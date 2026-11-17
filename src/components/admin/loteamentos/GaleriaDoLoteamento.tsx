"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { apagarArquivoEnviado, chamarApi, enviarArquivo } from "@/components/admin/comum/cliente-api";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { ListaOrdenavel } from "@/components/admin/comum/ListaOrdenavel";
import { REGRAS_DE_ARQUIVO } from "@/components/admin/comum/CampoUpload";
import { urlPublica } from "@/lib/conteudo/url";
import type { MidiaAdmin } from "./consultas";

type Props = {
  adminPath: string;
  loteamentoId: string;
  midias: MidiaAdmin[];
};

function Legenda({ adminPath, loteamentoId, midia }: { adminPath: string; loteamentoId: string; midia: MidiaAdmin }) {
  const [texto, setTexto] = useState(midia.legenda ?? "");
  const [salvo, setSalvo] = useState(midia.legenda ?? "");
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (texto.trim() === salvo) return;
    const resposta = await chamarApi(adminPath, `loteamentos/${loteamentoId}/midias/${midia.id}`, "PATCH", {
      legenda: texto,
    });
    if (resposta.ok) {
      setSalvo(texto.trim());
      setErro(null);
    } else {
      setErro(resposta.erros.legenda ?? resposta.erro);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        value={texto}
        maxLength={200}
        placeholder="Legenda (opcional)"
        aria-label="Legenda da mídia"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvar}
      />
      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}

export function GaleriaDoLoteamento({ adminPath, loteamentoId, midias }: Props) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erros, setErros] = useState<string[]>([]);

  async function adicionar(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(evento.target.files ?? []);
    evento.target.value = "";
    if (arquivos.length === 0) return;

    const falhas: string[] = [];
    for (const [indice, arquivo] of arquivos.entries()) {
      setEnviando(`Enviando ${indice + 1} de ${arquivos.length}...`);
      const ehVideo = arquivo.type === "video/mp4";
      const regras = REGRAS_DE_ARQUIVO[ehVideo ? "video" : "imagem"];

      if (arquivo.size > regras.limite) {
        falhas.push(`${arquivo.name}: passa do limite. ${regras.dica}`);
        continue;
      }

      const envio = await enviarArquivo(
        adminPath,
        { destino: "loteamentos", donoId: loteamentoId, tipo: ehVideo ? "video" : "imagem" },
        arquivo,
        (fracao) => setEnviando(`Enviando ${indice + 1} de ${arquivos.length}... ${Math.round(fracao * 100)}%`),
      );
      if (!envio.ok || !envio.details) {
        falhas.push(`${arquivo.name}: ${envio.erro ?? "não foi possível enviar."}`);
        continue;
      }

      const registro = await chamarApi(adminPath, `loteamentos/${loteamentoId}/midias`, "POST", {
        tipo: ehVideo ? "video" : "foto",
        path: envio.details.path,
      });
      if (!registro.ok) {
        await apagarArquivoEnviado(adminPath, envio.details.path);
        falhas.push(`${arquivo.name}: ${registro.erro ?? "não foi possível salvar."}`);
      }
    }

    setEnviando(null);
    setErros(falhas);
    router.refresh();
  }

  async function remover(midia: MidiaAdmin) {
    const resposta = await chamarApi(adminPath, `loteamentos/${loteamentoId}/midias/${midia.id}`, "DELETE");
    if (!resposta.ok) return resposta.erro;
    router.refresh();
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={entrada}
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          accept={`${REGRAS_DE_ARQUIVO.imagem.accept},${REGRAS_DE_ARQUIVO.video.accept}`}
          className="sr-only"
          onChange={adicionar}
        />
        <Button type="button" variant="outline" disabled={enviando !== null} onClick={() => entrada.current?.click()}>
          <ImagePlus aria-hidden="true" />
          Adicionar fotos ou vídeos
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {enviando ?? "Fotos: JPEG, PNG ou WebP, até 10 MB. Vídeos: MP4, até 15 MB."}
        </span>
      </div>

      {erros.length > 0 && (
        <ul className="flex flex-col gap-1" role="alert">
          {erros.map((erro) => (
            <li key={erro} className="text-sm text-destructive">
              {erro}
            </li>
          ))}
        </ul>
      )}

      {midias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto ou vídeo na galeria ainda.</p>
      ) : (
        <ListaOrdenavel
          key={midias.map((midia) => midia.id).join(",")}
          adminPath={adminPath}
          caminhoOrdem={`loteamentos/${loteamentoId}/midias`}
          rotulo="Galeria do loteamento"
          itens={midias.map((midia) => ({
            id: midia.id,
            conteudo: (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="h-24 w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-36">
                  {midia.tipo === "video" ? (
                    <video src={urlPublica(midia.path)} preload="metadata" muted className="size-full object-cover" />
                  ) : (
                    <Image
                      src={urlPublica(midia.path)}
                      alt={midia.legenda ?? "Foto do loteamento"}
                      width={288}
                      height={192}
                      unoptimized
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {midia.tipo === "video" ? "Vídeo" : "Foto"}
                  </span>
                  <Legenda adminPath={adminPath} loteamentoId={loteamentoId} midia={midia} />
                  <div>
                    <ConfirmarExclusao
                      tamanho="xs"
                      aviso="Remover da galeria e apagar o arquivo?"
                      aoConfirmar={() => remover(midia)}
                    />
                  </div>
                </div>
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}
