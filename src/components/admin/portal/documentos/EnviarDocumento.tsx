"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp, Upload } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import type { EstruturaDocumentos } from "@/lib/portal/documentos/tipos";
import { formatarTamanho } from "@/lib/portal/documentos/regras";
import { enviarPdf, validarPdfLocal } from "./api";

const formularioSchema = z.object({
  titulo: z.string().trim().min(2, "Informe o título.").max(160, "O título passa de 160 caracteres."),
  projetoId: z.string(),
  categoriaId: z.string(),
});
type Formulario = z.infer<typeof formularioSchema>;

type Props = { adminPath: string; empreendimentoId: string; estrutura: EstruturaDocumentos };

export function EnviarDocumento({ adminPath, empreendimentoId, estrutura }: Props) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const { control, handleSubmit, setValue, reset, formState: { isSubmitting } } = useForm<Formulario>({
    resolver: zodResolver(formularioSchema),
    defaultValues: { titulo: "", projetoId: "", categoriaId: "" },
  });
  const projetoId = useWatch({ control, name: "projetoId" });
  const categorias = estrutura.categorias.filter((categoria) => categoria.projetoId === projetoId);

  async function escolher(evento: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0] ?? null;
    evento.target.value = "";
    setAviso(null);
    if (!escolhido) return;
    const falha = await validarPdfLocal(escolhido);
    setErroArquivo(falha);
    setArquivo(falha ? null : escolhido);
  }

  async function enviar(dados: Formulario) {
    setErro(null);
    setAviso(null);
    if (!arquivo) {
      setErroArquivo("Escolha um arquivo PDF.");
      return;
    }
    setProgresso(0);
    const resposta = await enviarPdf(adminPath, {
      empreendimentoId,
      projetoId: dados.projetoId || null,
      categoriaId: dados.projetoId && dados.categoriaId ? dados.categoriaId : null,
      titulo: dados.titulo,
    }, arquivo, setProgresso);
    setProgresso(null);
    if (!resposta.ok) {
      setErro(resposta.erro);
      return;
    }
    reset();
    setArquivo(null);
    setAviso("Documento enviado. Ele fica oculto até você liberar para o cliente.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(enviar)} noValidate aria-label="Enviar documento" className="rounded-xl border bg-card p-5">
      <h2 className="mb-4 text-lg font-medium">Enviar novo PDF</h2>
      <FieldGroup>
        <Controller
          name="titulo"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="titulo-documento">Título</FieldLabel>
              <Input {...field} id="titulo-documento" maxLength={160} aria-invalid={fieldState.invalid} />
              <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
            </Field>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="projeto-documento">Projeto (opcional)</FieldLabel>
            <Select
              id="projeto-documento"
              value={projetoId}
              onChange={(evento) => {
                setValue("projetoId", evento.target.value);
                setValue("categoriaId", "");
              }}
            >
              <option value="">Sem projeto</option>
              {estrutura.projetos.map((projeto) => <option key={projeto.id} value={projeto.id}>{projeto.nome}</option>)}
            </Select>
          </Field>
          <Controller
            name="categoriaId"
            control={control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="categoria-documento">Categoria (opcional)</FieldLabel>
                <Select {...field} id="categoria-documento" disabled={!projetoId}>
                  <option value="">Sem categoria</option>
                  {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
                </Select>
              </Field>
            )}
          />
        </div>
        <Field data-invalid={Boolean(erroArquivo)}>
          <FieldLabel htmlFor="arquivo-documento">Arquivo PDF</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={entrada} id="arquivo-documento" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={isSubmitting} onChange={escolher} />
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => entrada.current?.click()}>
              <FileUp aria-hidden="true" />{arquivo ? "Trocar arquivo" : "Escolher PDF"}
            </Button>
            <span className="min-w-0 break-words text-sm text-muted-foreground">
              {arquivo ? `${arquivo.name} · ${formatarTamanho(arquivo.size)}` : "PDF de até 100 MB."}
            </span>
          </div>
          <MensagemDeErro>{erroArquivo}</MensagemDeErro>
        </Field>
      </FieldGroup>

      {progresso !== null && (
        <div className="mt-4" role="progressbar" aria-label="Progresso do envio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progresso * 100)}>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full origin-left rounded-full bg-primary transition-transform duration-200 ease-out" style={{ transform: `scaleX(${progresso})`, width: "100%" }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {progresso >= 1 ? "Conferindo o arquivo..." : `Enviando ${Math.round(progresso * 100)}%`}
          </p>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2" aria-live="polite">
        <MensagemDeErro>{erro}</MensagemDeErro>
        {aviso && <p className="text-sm text-primary">{aviso}</p>}
      </div>
      <Button type="submit" className="mt-4" disabled={isSubmitting}><Upload aria-hidden="true" />{isSubmitting ? "Enviando..." : "Enviar documento"}</Button>
    </form>
  );
}
