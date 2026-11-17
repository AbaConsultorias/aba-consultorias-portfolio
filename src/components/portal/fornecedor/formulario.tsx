"use client";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Check, Save, X, type LucideIcon } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { MENSAGEM_FALHA_NO_SERVIDOR, buscar, mensagemDaFalha } from "@/components/portal/comum/falhas";

export type CampoFornecedor = { nome: string; rotulo: string; tipo?: "longo" | "boolean" | "select" | "arquivo"; nullable?: boolean; accept?: string; ajuda?: string; filtrarFornecedor?: boolean; opcoes?: { valor: string; nome: string; fornecedorId?: string }[] };
export async function requisitar(endpoint: string, metodo: string, dados: unknown): Promise<unknown> {
  const resposta = await buscar(endpoint, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
  const json = z.object({ details: z.unknown().optional() }).parse(await resposta.json().catch(() => { throw new Error(resposta.status >= 500 ? MENSAGEM_FALHA_NO_SERVIDOR : "Não foi possível falar com o servidor. Tente novamente."); }) as unknown);
  if (!resposta.ok) throw new Error(mensagemDaFalha(json.details, resposta.status));
  return json.details;
}

export function FormularioFornecedor({ schema, campos, valores, salvar, rotulo = "Salvar", limpar = false, Icone = Save, decisao }: {
  schema: z.ZodType; campos: CampoFornecedor[]; valores: Record<string, unknown>; salvar: (dados: Record<string, unknown>) => Promise<unknown>; rotulo?: string; limpar?: boolean;
  Icone?: LucideIcon; decisao?: { campo: string; aprovar: string; recusar: string };
}) {
  const id = useId();
  const router = useRouter();
  const [mensagem, setMensagem] = useState("");
  const [falhou, setFalhou] = useState(false);
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema as z.ZodType<Record<string, unknown>, Record<string, unknown>>), defaultValues: valores });
  const fornecedorId = useWatch({ control: form.control, name: "fornecedorId" });
  const todos = useWatch({ control: form.control });
  const escolhida = decisao ? todos[decisao.campo] : undefined;
  const tom = decisao && escolhida === decisao.aprovar ? "aprovar" : decisao && escolhida === decisao.recusar ? "devolver" : undefined;
  async function enviar(dados: Record<string, unknown>) {
    setMensagem(""); setFalhou(false);
    try {
      await salvar(dados);
      if (limpar) form.reset(valores);
      setMensagem("Alteração salva."); router.refresh();
    } catch (error) { setFalhou(true); setMensagem(error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente."); }
  }
  return <form noValidate onSubmit={form.handleSubmit(enviar)} className="forn-form">
    <fieldset disabled={form.formState.isSubmitting}>
      {campos.map((campo) => <Controller key={campo.nome} name={campo.nome} control={form.control} render={({ field, fieldState }) => {
        const campoId = `${id}-${campo.nome}`;
        const opcoes = campo.filtrarFornecedor ? campo.opcoes?.filter((o) => o.fornecedorId === fornecedorId) : campo.opcoes;
        const acessibilidade = { id: campoId, "aria-invalid": fieldState.invalid, "aria-describedby": `${campoId}-ajuda ${campoId}-erro` };
        return <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={campoId}>{campo.rotulo}</FieldLabel>
          {campo.tipo === "boolean" ? <input {...acessibilidade} type="checkbox" checked={field.value === true} onChange={(e) => field.onChange(e.target.checked)} className="size-5 accent-primary" />
            : campo.tipo === "select" ? <select {...acessibilidade} name={field.name} ref={field.ref} onBlur={field.onBlur} value={String(field.value ?? "")} onChange={(e) => { field.onChange(e.target.value || (campo.nullable ? null : "")); if (campo.nome === "fornecedorId") form.setValue("empreendimentoId", null); }}><option value="">{campo.nullable ? "Sem empreendimento" : "Selecione"}</option>{opcoes?.map((opcao, indice) => <option key={`${opcao.valor}-${indice}`} value={opcao.valor}>{opcao.nome}</option>)}</select>
            : campo.tipo === "longo" ? <textarea {...acessibilidade} {...field} rows={4} value={String(field.value ?? "")} onChange={(e) => field.onChange(e.target.value || (campo.nullable ? null : ""))} />
            : campo.tipo === "arquivo" ? <Input {...acessibilidade} name={field.name} ref={field.ref} onBlur={field.onBlur} type="file" accept={campo.accept} onChange={(e) => field.onChange(e.target.files?.[0] ?? null)} />
            : <Input {...acessibilidade} {...field} value={String(field.value ?? "")} onChange={(e) => field.onChange(e.target.value || (campo.nullable ? null : ""))} />}
          <p id={`${campoId}-ajuda`} className="forn-ajuda">{campo.ajuda}</p>
          <FieldError id={`${campoId}-erro`} errors={fieldState.error ? [fieldState.error] : undefined} />
        </Field>;
      }} />)}
      <Button type="submit" className={decisao ? "portal-botao portal-decisao" : "portal-botao"} data-decisao={tom}>{tom === "aprovar" ? <Check size={18} aria-hidden="true" /> : tom === "devolver" ? <X size={18} aria-hidden="true" /> : <Icone size={18} aria-hidden="true" />}{form.formState.isSubmitting ? "Aguarde…" : rotulo}</Button>
    </fieldset>
    <p aria-live="polite" role={falhou ? "alert" : "status"} className="forn-mensagem">{mensagem}</p>
  </form>;
}
