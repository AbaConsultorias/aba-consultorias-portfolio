"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, RotateCcw, Trash2, Upload, X } from "lucide-react";
import z from "zod";
import { assinarSchema } from "@/app/api/(modules)/adm-interno/portal/atualizacao-fotos/upload/schema";
import { atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/atualizacao-fotos/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Formulario } from "./Formulario";
import { Fotos } from "@/components/portal/andamento/Fotos";

import { confirmarFoto, enviarFoto, mensagemErroFoto, mimeDoArquivo, TIPOS_FOTO } from "./uploadFoto";

export function FotosAdmin({ adminPath, atualizacaoId, registros, somenteLeitura = false }: { adminPath: string; atualizacaoId: string; registros: { id: string; mime: string; ordem: number }[]; somenteLeitura?: boolean }) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [comprovante, setComprovante] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [remover, setRemover] = useState<string | null>(null);
  const endpoint = `/${adminPath}/api/portal/atualizacao-fotos`;
  const form = useForm<z.infer<typeof assinarSchema>>({ resolver: zodResolver(assinarSchema), defaultValues: { atualizacaoId, ordem: registros.length } });
  async function confirmar(token: string) {
    await confirmarFoto(endpoint, token);
    setComprovante(null); setMensagem("Foto confirmada."); router.refresh();
  }
  async function enviar(entrada: z.infer<typeof assinarSchema>) {
    if (!arquivo || ocupado) return;
    setOcupado(true); setMensagem("");
    try {
      await enviarFoto({ endpoint, entrada, arquivo, aoComprovante: setComprovante });
      setComprovante(null); setMensagem("Foto confirmada."); router.refresh();
    } catch (erro) { setMensagem(mensagemErroFoto(erro)); } finally { setOcupado(false); }
  }
  async function excluir(id: string) {
    setOcupado(true);
    try {
      const resposta = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!resposta.ok) throw new Error("Falha ao remover. A atualização permanece oculta; tente novamente.");
      setRemover(null); setMensagem("Foto removida. Revise a atualização antes de publicá-la novamente."); router.refresh();
    } catch (erro) { setMensagem(erro instanceof Error ? erro.message : "Falha ao remover."); } finally { setOcupado(false); }
  }
  return <section className="space-y-6"><h2 className="text-xl font-medium">Fotos da atualização</h2>{!somenteLeitura && <p className="text-sm text-muted-foreground">JPEG, PNG, WebP, HEIC ou HEIF, até 10 MiB. A remoção de foto oculta a atualização.</p>}
    {!somenteLeitura && <form noValidate onSubmit={form.handleSubmit(enviar)} className="space-y-4 rounded-xl border bg-card p-5"><fieldset disabled={ocupado || !!comprovante} className="space-y-4">
      <Field><FieldLabel htmlFor="foto-arquivo">Arquivo</FieldLabel><Input id="foto-arquivo" type="file" accept={TIPOS_FOTO} onChange={(e) => {
        const file = e.target.files?.[0] ?? null; setArquivo(file);
        form.setValue("tamanho", file?.size ?? 0);
        form.setValue("mime", mimeDoArquivo(file) as z.infer<typeof assinarSchema>["mime"]);
      }} /><FieldError errors={[form.formState.errors.mime, form.formState.errors.tamanho].filter(Boolean)} /></Field>
      <Field><FieldLabel htmlFor="foto-ordem">Ordem</FieldLabel><Input id="foto-ordem" type="number" {...form.register("ordem", { valueAsNumber: true })} /><FieldError errors={[form.formState.errors.ordem].filter(Boolean)} /></Field>
      <Button type="submit" disabled={!arquivo}><Upload aria-hidden="true" />Enviar foto</Button></fieldset>
    </form>}
    {!somenteLeitura && comprovante && <Button disabled={ocupado} onClick={async () => { setOcupado(true); try { await confirmar(comprovante); } catch { setMensagem("A confirmação falhou novamente. Confira o arquivo ou tente mais tarde."); } finally { setOcupado(false); } }}><RotateCcw aria-hidden="true" />Tentar confirmar novamente</Button>}
    <p role="status" className="text-sm">{mensagem}</p>
    <div className="space-y-5">{registros.map((foto) => <article key={foto.id} className="rounded-xl border bg-card p-5"><Fotos fotos={[{ ...foto, urlDaRota: `/api/portal/atualizacao-fotos/${foto.id}` }]} />{!somenteLeitura && <><Formulario schema={atualizarSchema} valores={foto} campos={[{ nome: "ordem", rotulo: "Ordem", tipo: "numero" }]} endpoint={endpoint} metodo="PATCH" rotulo="Salvar ordem" />
      <Button variant="destructive" disabled={ocupado} onClick={() => setRemover(foto.id)}><Trash2 aria-hidden="true" />Remover foto</Button></>}{!somenteLeitura && remover === foto.id && <div className="mt-4"><p>Ocultar a atualização e remover esta foto?</p><Button variant="destructive" disabled={ocupado} onClick={() => excluir(foto.id)}><Check aria-hidden="true" />Confirmar remoção</Button><Button variant="outline" onClick={() => setRemover(null)}><X aria-hidden="true" />Cancelar</Button></div>}
    </article>)}</div>
  </section>;
}
