"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcw, Send } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { enviarArquivoAssinado } from "@/components/portal/comum/enviarArquivoAssinado";
import { enviarSchema, type EnviarRelatoInput } from "@/app/api/(modules)/portal/empreiteiro/relatos/schema";
import { assinarSchema } from "@/app/api/(modules)/portal/empreiteiro/relatos/upload/assinar/schema";
import { SITUACOES_OBRA } from "@/lib/portal/obras/regras";
import type { RelatoObra } from "@/lib/portal/obras/tipos";
import { FotosSelecionadas } from "./FotosSelecionadas";
import { ErroRequisicao, requisicao } from "./requisicao";

const assinaturaSchema = z.object({ relatoId: z.uuid(), fotos: z.array(z.object({ path: z.string(), signedUrl: z.url(), token: z.string(), comprovante: z.string() })) });
type Tentativa = { assinatura?: z.infer<typeof assinaturaSchema>; enviados: Set<number>; corpo?: EnviarRelatoInput };
const formularioSchema = enviarSchema.pick({ texto: true, percentualInformado: true, situacaoInformada: true });
type Campos = z.infer<typeof formularioSchema>;

// Alguns sistemas deixam o MIME vazio para HEIC/HEIF; o servidor confere os bytes reais.
function mimeDoArquivo(arquivo: File): string {
  const extensoes: Record<string, string> = { heic: "image/heic", heif: "image/heif" };
  return arquivo.type || extensoes[arquivo.name.split(".").pop()?.toLowerCase() ?? ""] || "";
}

export function NovoRelato({ obraId, base }: { obraId: string; base: RelatoObra | null }) {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [estados, setEstados] = useState<string[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [bloqueado, setBloqueado] = useState(false);
  const [corpoPronto, setCorpoPronto] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const tentativa = useRef<Tentativa>({ enviados: new Set() });
  const form = useForm<Campos>({ resolver: zodResolver(formularioSchema), defaultValues: { texto: base?.texto ?? "", percentualInformado: base?.percentualInformado ?? null, situacaoInformada: base?.situacaoInformada ?? null } });
  function estado(indice: number, valor: string) { setEstados((anteriores) => { const proximos = [...anteriores]; proximos[indice] = valor; return proximos; }); }
  function selecionar(lista: FileList | null) {
    const novos = [...arquivos, ...Array.from(lista ?? [])];
    const resultado = assinarSchema.safeParse({ obraId, fotos: novos.map((arquivo) => ({ mime: mimeDoArquivo(arquivo), tamanho: arquivo.size })) });
    if (!resultado.success) { setMensagem("Escolha até 10 fotos JPEG, PNG, WebP, HEIC ou HEIF, de até 10 MiB cada."); return; }
    setArquivos(novos); setEstados([]); setMensagem("");
  }
  async function enviar(campos: Campos) {
    setMensagem(""); setBloqueado(true);
    const atual = tentativa.current;
    try {
      if (!atual.corpo) {
        if (arquivos.length && !atual.assinatura) atual.assinatura = await requisicao("/api/portal/empreiteiro/relatos/upload/assinar", "POST", { obraId, fotos: arquivos.map((arquivo) => ({ mime: mimeDoArquivo(arquivo), tamanho: arquivo.size })) }, assinaturaSchema);
        if (atual.assinatura) {
          if (atual.assinatura.fotos.length !== arquivos.length) throw new Error("Não foi possível preparar todas as fotos.");
          for (const [indice, arquivo] of arquivos.entries()) {
            if (atual.enviados.has(indice)) continue;
            estado(indice, "Enviando…");
            try { await enviarArquivoAssinado({ signedUrl: atual.assinatura.fotos[indice].signedUrl, arquivo, mime: mimeDoArquivo(arquivo) }); }
            catch (falha) { estado(indice, "Não foi possível enviar esta foto."); throw new Error(`${falha instanceof Error ? falha.message : "O envio de uma foto foi interrompido."} Clique em Tentar envio novamente para continuar de onde parou. Se continuar falhando, use Preparar fotos novamente.`); }
            atual.enviados.add(indice); estado(indice, "Enviada; aguardando conferência");
          }
        }
        atual.corpo = { ...campos, obraId, relatoId: atual.assinatura?.relatoId ?? crypto.randomUUID(), comprovantes: atual.assinatura?.fotos.map((foto) => foto.comprovante) ?? [] };
        setCorpoPronto(true);
      }
      await requisicao("/api/portal/empreiteiro/relatos", "POST", atual.corpo, z.object({ id: z.uuid() }));
      setEstados(arquivos.map(() => "Aceita")); setConcluido(true); setMensagem("Relato enviado para revisão.");
      router.push(`/empreiteiro/obras/${obraId}`); router.refresh();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : "Não foi possível enviar. Tente novamente.");
      if (error instanceof ErroRequisicao && error.status >= 400 && error.status < 500 && error.status !== 429) {
        tentativa.current = { enviados: new Set() }; setCorpoPronto(false); setBloqueado(false); setEstados(arquivos.map(() => "Confira o arquivo e envie novamente"));
      } else if (!atual.assinatura && !atual.corpo) setBloqueado(false);
    }
  }
  return <form className="obras-painel" noValidate onSubmit={(evento) => form.handleSubmit(enviar)(evento)}>
    {base && <p className="obras-aviso">Revise o texto e os dados antes de enviar. As fotos do relato anterior não são copiadas.</p>}
    <fieldset disabled={bloqueado || form.formState.isSubmitting} className="obras-campos">
      <Controller control={form.control} name="texto" render={({ field, fieldState }) => <Field><FieldLabel htmlFor="relato-texto">O que foi realizado?</FieldLabel><textarea {...field} id="relato-texto" rows={6} maxLength={5000} aria-invalid={fieldState.invalid} /><FieldError errors={fieldState.error ? [fieldState.error] : undefined} /></Field>} />
      <div className="obras-campos-duplos">
        <Controller control={form.control} name="percentualInformado" render={({ field, fieldState }) => <Field><FieldLabel htmlFor="relato-percentual">Percentual de conclusão (opcional)</FieldLabel><Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))} id="relato-percentual" type="number" min={0} max={100} step={1} aria-invalid={fieldState.invalid} /><FieldError errors={fieldState.error ? [fieldState.error] : undefined} /></Field>} />
        <Controller control={form.control} name="situacaoInformada" render={({ field, fieldState }) => <Field><FieldLabel htmlFor="relato-situacao">Situação (opcional)</FieldLabel><select {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} id="relato-situacao" aria-invalid={fieldState.invalid}><option value="">Não informar</option>{SITUACOES_OBRA.map((item) => <option key={item.valor} value={item.valor}>{item.nome}</option>)}</select><FieldError errors={fieldState.error ? [fieldState.error] : undefined} /></Field>} />
      </div>
      <Field><FieldLabel htmlFor="relato-fotos">Fotos (opcional)</FieldLabel><Input id="relato-fotos" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={(e) => { selecionar(e.target.files); e.target.value = ""; }} /><p className="text-sm text-muted-foreground">Até 10 fotos, com até 10 MiB cada. {arquivos.length} selecionadas.</p></Field>
    </fieldset>
    <FotosSelecionadas arquivos={arquivos} estados={estados} bloqueado={bloqueado} remover={(indice) => { setArquivos(arquivos.filter((_, i) => i !== indice)); setEstados([]); }} />
    <p className="text-sm text-muted-foreground">A ABA revisará o relato antes de atualizar o progresso oficial e disponibilizá-lo ao cliente.</p>
    <div className="obras-acoes"><Button className="portal-botao" variant={bloqueado && !concluido && !form.formState.isSubmitting ? "outline" : "default"} disabled={form.formState.isSubmitting || concluido} type="submit">{bloqueado && !concluido && !form.formState.isSubmitting ? <RotateCcw size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}{concluido ? "Relato enviado" : form.formState.isSubmitting ? "Enviando…" : bloqueado ? "Tentar envio novamente" : "Enviar relato"}</Button>
      {bloqueado && !corpoPronto && <Button className="portal-botao" type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => { tentativa.current = { enviados: new Set() }; setCorpoPronto(false); setBloqueado(false); setEstados([]); setMensagem("Fotos prontas para um novo envio."); }}><RotateCcw size={18} aria-hidden="true" />Preparar fotos novamente</Button>}
    </div><p className="obras-mensagem" role="status">{mensagem}</p>
  </form>;
}
