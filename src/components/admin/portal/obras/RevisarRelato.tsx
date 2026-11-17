"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Undo2 } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/relatos/schema";
import { sugerirRevisao, avisoDeConsistencia, SITUACOES_OBRA } from "@/lib/portal/obras/regras";
import type { RelatoFila } from "@/lib/portal/obras/tipos";
import { requisicao } from "@/components/portal/obras/requisicao";

export function RevisarRelato({ relato, adminPath }: { relato: RelatoFila; adminPath: string }) {
  const id = useId();
  const router = useRouter();
  const [mensagem, setMensagem] = useState("");
  const sugestao = sugerirRevisao(relato, { percentual: relato.percentualAtual, situacao: relato.situacaoAtual });
  const form = useForm<z.infer<typeof atualizarSchema>>({ resolver: zodResolver(atualizarSchema), defaultValues: { id: relato.id, acao: "aprovar", ...sugestao } });
  const acao = useWatch({ control: form.control, name: "acao" });
  const percentual = useWatch({ control: form.control, name: "percentual" });
  const situacao = useWatch({ control: form.control, name: "situacao" });
  const aviso = acao === "aprovar" ? avisoDeConsistencia(percentual, situacao) : null;
  async function salvar(entrada: z.infer<typeof atualizarSchema>) {
    setMensagem("");
    try { await requisicao(`/${adminPath}/api/portal/relatos`, "PATCH", entrada, z.object({ id: z.uuid() })); setMensagem("Revisão salva."); router.refresh(); }
    catch (error) { setMensagem(error instanceof Error ? error.message : "Não foi possível salvar a revisão."); }
  }
  return <form noValidate onSubmit={form.handleSubmit(salvar)} className="mt-6 space-y-4">
    <fieldset disabled={form.formState.isSubmitting} className="obras-campos">
      <Controller control={form.control} name="acao" render={({ field }) => <Field><FieldLabel htmlFor={`${id}-acao`}>Revisão da ABA</FieldLabel><select {...field} id={`${id}-acao`}><option value="aprovar">Aprovar</option><option value="devolver">Devolver para correção</option></select></Field>} />
      {acao === "aprovar" ? <><p className="text-sm text-muted-foreground">Confirme ou ajuste o progresso oficial da obra.</p><div className="obras-campos-duplos">
        <Controller control={form.control} name="percentual" render={({ field, fieldState }) => <Field><FieldLabel htmlFor={`${id}-percentual`}>Percentual oficial</FieldLabel><Input {...field} type="number" min={0} max={100} step={1} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} id={`${id}-percentual`} aria-invalid={fieldState.invalid} /><FieldError errors={fieldState.error ? [fieldState.error] : undefined} /></Field>} />
        <Controller control={form.control} name="situacao" render={({ field, fieldState }) => <Field><FieldLabel htmlFor={`${id}-situacao`}>Situação oficial</FieldLabel><select {...field} id={`${id}-situacao`} aria-invalid={fieldState.invalid}>{SITUACOES_OBRA.map((item) => <option key={item.valor} value={item.valor}>{item.nome}</option>)}</select><FieldError errors={fieldState.error ? [fieldState.error] : undefined} /></Field>} />
      </div>{aviso && <p className="obras-aviso" role="status">{aviso}</p>}</> : <Controller control={form.control} name="motivo" render={({ field, fieldState }) => <Field><FieldLabel htmlFor={`${id}-motivo`}>Motivo da devolução</FieldLabel><textarea {...field} value={field.value ?? ""} id={`${id}-motivo`} maxLength={500} rows={3} aria-invalid={fieldState.invalid} /><FieldError errors={fieldState.error ? [fieldState.error] : undefined} /></Field>} />}
      <Button type="submit" className="portal-botao portal-decisao justify-self-start" data-decisao={acao === "aprovar" ? "aprovar" : "devolver"}>{acao === "aprovar" ? <Check size={18} aria-hidden="true" /> : <Undo2 size={18} aria-hidden="true" />}{form.formState.isSubmitting ? "Salvando…" : acao === "aprovar" ? "Aprovar e atualizar obra" : "Devolver com motivo"}</Button>
    </fieldset><p role="status" className="obras-mensagem">{mensagem}</p>
  </form>;
}
