"use client";
import { useRef, useState } from "react";
import { useForm, Controller, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { recursos, valoresIniciais, type Registro } from "./recursos";
import { schemas, type NomeRecurso } from "./schemas";
import { ArquivoCampo } from "./ArquivoCampo";
import { ItensCampo } from "./ItensCampo";
import { requisitar, removerArquivos } from "./requisicao";
const controle = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring";
export function EditorRegistro({ recurso, registro, adminPath, donoId, proximaOrdem, onSalvar, onCancelar }: {
    recurso: NomeRecurso;
    registro?: Registro;
    adminPath: string;
    donoId?: string;
    proximaOrdem: number;
    onSalvar: (registro: Registro) => void;
    onCancelar: () => void;
}) {
    const definicao = recursos[recurso];
    const uploads = useRef<string[]>([]);
    const slugEditado = useRef(Boolean(registro));
    const [erro, setErro] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [limpando, setLimpando] = useState(false);
    const [limpeza, setLimpeza] = useState<{
        registro: Registro;
        arquivos: string[];
    } | null>(null);
    const iniciais = valoresIniciais(recurso, registro, donoId);
    if (!registro)
        iniciais.ordem = proximaOrdem;
    const { control, handleSubmit, setValue, formState: { isSubmitting } } = useForm<Record<string, unknown>>({ resolver: zodResolver(schemas[recurso]) as unknown as Resolver<Record<string, unknown>>, defaultValues: iniciais });
    const titulo = useWatch({ control, name: "titulo" });
    const destaque = useWatch({ control, name: "titulo_destaque" });
    const tipo = useWatch({ control, name: "tipo" });
    const origem = useWatch({ control, name: "origem" });
    async function salvar(valores: Record<string, unknown>) {
        setErro("");
        try {
            const details = await requisitar(adminPath, recurso, registro ? "PATCH" : "POST", { ...valores, ...(registro ? { id: registro.id } : {}) });
            const salvo = z.object({ id: z.uuid() }).passthrough().parse(details.registro) as Registro;
            const mantidos = definicao.arquivos.map(c => salvo[c]);
            const antigos = definicao.arquivos.flatMap(c => typeof registro?.[c] === "string" ? [String(registro[c])] : []);
            const apagar = [...antigos, ...uploads.current].filter(v => !mantidos.includes(v));
            uploads.current = [];
            if (apagar.length) {
                setLimpeza({ registro: salvo, arquivos: apagar });
                try {
                    await removerArquivos(adminPath, apagar);
                }
                catch {
                    setErro("Alterações salvas. Falta remover os arquivos antigos. Tente a limpeza novamente.");
                    return;
                }
                setLimpeza(null);
            }
            onSalvar(salvo);
        }
        catch (error) {
            setErro(error instanceof Error ? error.message : "Não foi possível salvar.");
        }
    }
    async function cancelar() {
        setErro("");
        setLimpando(true);
        try {
            await removerArquivos(adminPath, uploads.current);
            onCancelar();
        }
        catch {
            setErro("Não foi possível remover os envios pendentes. Tente cancelar novamente.");
        }
        finally {
            setLimpando(false);
        }
    }
    async function repetirLimpeza() {
        if (!limpeza)
            return;
        setLimpando(true);
        setErro("");
        try {
            await removerArquivos(adminPath, limpeza.arquivos);
            setLimpeza(null);
            onSalvar(limpeza.registro);
        }
        catch {
            setErro("Alterações salvas. Não foi possível remover todos os arquivos antigos. Tente novamente.");
        }
        finally {
            setLimpando(false);
        }
    }
    const bloqueado = isSubmitting || enviando || limpando || Boolean(limpeza);
    return <section aria-label={registro ? "Editar registro" : "Novo registro"} className="rounded-xl border bg-card p-4 sm:p-6">
  <h2 className="mb-5 text-xl font-semibold">{registro ? "Editar registro" : "Novo registro"}</h2>
  <form noValidate onSubmit={event => {
        void handleSubmit(salvar)(event);
    }} className="space-y-5">
   <fieldset disabled={bloqueado} className="min-w-0 space-y-5">
   {definicao.campos.map(c => <Controller key={c.nome} name={c.nome} control={control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}>
    <FieldLabel htmlFor={`campo-${recurso}-${c.nome}`}>{c.rotulo}</FieldLabel>
    {c.tipo === "arquivo" ? <ArquivoCampo id={`campo-${recurso}-${c.nome}`} adminPath={adminPath} destino={c.destino!} donoId={recurso === "projetos" ? registro?.id : donoId} video={c.video || (recurso === "midias-projeto" && tipo === "video")} value={typeof field.value === "string" ? field.value : null} onChange={field.onChange} onUpload={path => uploads.current.push(path)} onOcupado={setEnviando} disabled={bloqueado}/>
                    : c.tipo === "lista" ? <ItensCampo value={Array.isArray(field.value) ? field.value as string[] : []} onChange={field.onChange}/>
                        : c.tipo === "area" ? <textarea {...field} value={String(field.value ?? "")} id={`campo-${recurso}-${c.nome}`} rows={5} className={controle} aria-invalid={fieldState.invalid}/>
                            : c.tipo === "select" ? <select {...field} value={String(field.value ?? "")} id={`campo-${recurso}-${c.nome}`} className={controle} aria-invalid={fieldState.invalid} onChange={e => {
                                    field.onChange(e);
                                    if (c.nome === "origem" && e.target.value !== "google")
                                        setValue("nota", null);
                                }}>{c.opcoes?.map(([v, label]) => <option key={v} value={v}>{label}</option>)}{c.nome === "icone" && Boolean(field.value) && !c.opcoes?.some(([v]) => v === field.value) && <option value={String(field.value)}>{String(field.value)}</option>}</select>
                                : <Input name={field.name} ref={field.ref} onBlur={field.onBlur} id={`campo-${recurso}-${c.nome}`} value={String(field.value ?? "")} type={c.tipo === "numero" ? "number" : c.tipo === "data" ? "date" : "text"} step={c.nome === "google_nota" ? "0.1" : c.tipo === "numero" ? "1" : undefined} disabled={c.nome === "nota" && origem !== "google"} aria-invalid={fieldState.invalid} onChange={e => {
                                        const v = e.target.value;
                                        field.onChange(c.tipo === "numero" ? v === "" ? null : Number(v) : c.tipo === "data" ? v || null : v);
                                        if (c.nome === "slug")
                                            slugEditado.current = true;
                                        if (c.nome === "titulo" && !slugEditado.current && definicao.campos.some(campo => campo.nome === "slug"))
                                            setValue("slug", v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                                    }}/>}
    {c.dica && <p className="text-xs text-muted-foreground">{c.dica}</p>}<FieldError errors={fieldState.error ? [fieldState.error] : undefined}/>
   </Field>}/>)}
   </fieldset>
   {recurso === "banners" && <div className="rounded-lg bg-muted p-4" aria-live="polite"><p className="mb-2 text-xs text-muted-foreground">Prévia do título</p><p className="break-words text-2xl font-semibold">{String(titulo ?? "")} <em className="font-serif font-normal">{String(destaque ?? "")}</em></p></div>}
   {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
   {limpeza && <Button type="button" variant="outline" disabled={limpando || isSubmitting} onClick={() => void repetirLimpeza()}>Tentar remover arquivos antigos</Button>}
   <div className="flex flex-wrap gap-2"><Button type="submit" disabled={bloqueado}>{isSubmitting ? "Salvando…" : "Salvar"}</Button><Button type="button" variant="outline" disabled={bloqueado} onClick={() => void cancelar()}>Cancelar</Button></div>
  </form>
 </section>;
}
