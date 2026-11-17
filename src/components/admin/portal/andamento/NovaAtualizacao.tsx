"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Plus, RotateCcw, Save } from "lucide-react";
import z from "zod";
import { criarSchema } from "@/app/api/(modules)/adm-interno/portal/atualizacoes/schema";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { CamposFormulario, type Campo } from "./Formulario";
import { FotosSelecionadas } from "./FotosSelecionadas";
import { enviarFotosEPublicar, erroDoArquivo, type FotoSelecionada } from "./uploadFoto";

export function NovaAtualizacao({ adminPath, campos, valores, aoPendencia }: {
  adminPath: string; campos: Campo[]; valores: Record<string, unknown>; aoPendencia: (id: string | null) => void;
}) {
  const router = useRouter();
  const trava = useRef(false);
  const [atualizacaoId, setAtualizacaoId] = useState<string | null>(null);
  const [fotos, setFotos] = useState<FotoSelecionada[]>([]);
  const [publicar, setPublicar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const endpoint = `/${adminPath}/api/portal/atualizacoes`;
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(criarSchema as z.ZodType<Record<string, unknown>, Record<string, unknown>>), defaultValues: valores,
  });

  async function salvar(dados: Record<string, unknown>) {
    if (trava.current) return;
    if (fotos.some((foto) => erroDoArquivo(foto.arquivo))) {
      setMensagem("Remova os arquivos inválidos antes de salvar. Nenhuma atualização foi criada.");
      return;
    }
    trava.current = true; setOcupado(true); setMensagem("");
    let id = atualizacaoId;
    try {
      if (!id) {
        setMensagem("Criando rascunho…");
        const resposta = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
        if (!resposta.ok) {
          setMensagem(resposta.status >= 500
            ? "Não foi possível confirmar a criação. Confira a lista antes de tentar novamente, pois o rascunho pode ter sido salvo."
            : "Não foi possível criar. Confira os campos, os vínculos e tente novamente.");
          return;
        }
        id = z.object({ details: z.object({ id: z.uuid() }) }).parse(await resposta.json()).details.id;
        setAtualizacaoId(id); aoPendencia(id);
      }
      setMensagem("Rascunho salvo. Conferindo as fotos antes de concluir…");
      const falhas = await enviarFotosEPublicar({
        endpoint, endpointFotos: `/${adminPath}/api/portal/atualizacao-fotos`, atualizacaoId: id, fotos, publicar,
        aoAlterar: (fotoId, alteracao) => setFotos((atuais) => atuais.map((foto) => foto.id === fotoId ? { ...foto, ...alteracao } : foto)),
      });
      if (falhas.length) {
        setMensagem(`Atualização salva como rascunho, sem publicar. Fotos que falharam: ${falhas.join(", ")}. Tente novamente, remova as fotos com erro ou deixe para editar depois. As fotos confirmadas foram mantidas.`);
        return;
      }
      setConcluido(true); aoPendencia(null);
      setMensagem(publicar ? "Atualização e fotos publicadas para o cliente." : "Atualização e fotos salvas como rascunho.");
    } catch {
      setMensagem(id
        ? "Todas as fotos foram confirmadas, mas não foi possível confirmar a publicação. Confira a situação na lista ou tente concluir novamente. As fotos não serão reenviadas."
        : "Não foi possível confirmar a criação. Confira a lista antes de tentar novamente, pois o rascunho pode ter sido salvo.");
    } finally {
      trava.current = false; setOcupado(false); router.refresh();
    }
  }

  return <div className="space-y-5">
    <form noValidate onSubmit={(event) => { void form.handleSubmit(salvar)(event); }} className="space-y-5" aria-busy={ocupado}>
      <fieldset disabled={ocupado || !!atualizacaoId} className="space-y-5">
        <CamposFormulario campos={campos} control={form.control} metodo="nova-atualizacao" />
      </fieldset>
      <FotosSelecionadas fotos={fotos} aoAlterar={setFotos} bloqueado={ocupado || concluido} rascunhoCriado={!!atualizacaoId} />
      <Field><FieldLabel htmlFor="publicar-atualizacao-agora">
        <input id="publicar-atualizacao-agora" type="checkbox" className="size-5 accent-primary" checked={publicar} disabled={ocupado || !!atualizacaoId} onChange={(event) => setPublicar(event.target.checked)} />
        Publicar para o cliente agora
      </FieldLabel><p className="text-sm text-muted-foreground">A publicação só acontece depois da confirmação de todas as fotos. Mantenha esta tela aberta até concluir.</p></Field>
      {!concluido && <Button type="submit" disabled={ocupado}>{atualizacaoId && !ocupado ? <RotateCcw aria-hidden="true" /> : <Save aria-hidden="true" />}{ocupado ? "Salvando atualização…" : atualizacaoId ? "Tentar concluir novamente" : "Salvar atualização"}</Button>}
    </form>
    <p role="status" className="text-sm whitespace-pre-wrap break-words">{mensagem}</p>
    {atualizacaoId && !ocupado && <div className="flex flex-wrap gap-3">
      <Button variant="outline" asChild><Link prefetch={false} href={`/${adminPath}/portal/atualizacoes?atualizacaoId=${atualizacaoId}`}><Camera aria-hidden="true" />Revisar fotos{concluido ? "" : " / editar depois"}</Link></Button>
      {!concluido && <Button variant="outline" onClick={() => {
        setConcluido(true); aoPendencia(null);
        setMensagem("Atualização mantida para revisão. As fotos confirmadas foram preservadas; confira a situação na lista e revise as pendências em Fotos antes de publicar.");
      }}>Deixar para editar depois</Button>}
      {concluido && <Button variant="outline" onClick={() => {
        setAtualizacaoId(null); setFotos([]); setPublicar(false); setConcluido(false); setMensagem(""); form.reset(valores);
      }}><Plus aria-hidden="true" />Adicionar outra atualização</Button>}
    </div>}
  </div>;
}
