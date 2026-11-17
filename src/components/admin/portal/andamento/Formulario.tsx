"use client";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save, type LucideIcon } from "lucide-react";
import z from "zod";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { ListaItens } from "./ListaItens";

export type OpcaoCampo = { valor: string; nome: string; projetoId?: string };
// filtrarPor: o select só lista as opções cujo projetoId é o valor do campo indicado (ex.: etapas do projeto escolhido).
export type Campo = { nome: string; rotulo: string; tipo?: "texto" | "longo" | "senha" | "data" | "numero" | "boolean" | "select" | "lista"; nullable?: boolean; concluir?: boolean; marcas?: boolean; opcoes?: OpcaoCampo[]; filtrarPor?: { campo: string; vazio: string } };
export function Formulario({ schema, campos, valores, endpoint, metodo, aoSalvar, rotulo = "Salvar", Icone = Save }: {
  schema: z.ZodType; campos: Campo[]; valores: Record<string, unknown>; endpoint: string; metodo: "POST" | "PATCH"; aoSalvar?: () => void; rotulo?: string; Icone?: LucideIcon;
}) {
  const router = useRouter();
  const [mensagem, setMensagem] = useState("");
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema as z.ZodType<Record<string, unknown>, Record<string, unknown>>), defaultValues: valores });
  async function salvar(dados: Record<string, unknown>) {
    setMensagem("");
    try {
      const resposta = await fetch(endpoint, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados) });
      const json: unknown = await resposta.json();
      const resultado = z.object({ details: z.unknown().optional() }).parse(json);
      if (!resposta.ok) { setMensagem(typeof resultado.details === "string" ? resultado.details : "Confira os campos e vínculos. Não foi possível salvar."); return; }
      form.reset(valores.senha !== undefined ? { ...valores, senha: "" } : valores);
      setMensagem("Alteração salva."); router.refresh(); aoSalvar?.();
    } catch { setMensagem("Não foi possível concluir. Verifique a conexão antes de tentar novamente."); }
  }
  return <form noValidate onSubmit={form.handleSubmit(salvar)} className="space-y-5">
    <fieldset disabled={form.formState.isSubmitting} className="space-y-5">
      <CamposFormulario campos={campos} control={form.control} metodo={metodo} />
      <Button type="submit"><Icone aria-hidden="true" />{form.formState.isSubmitting ? "Salvando…" : rotulo}</Button>
    </fieldset><p aria-live="polite" className="text-sm">{mensagem}</p>
  </form>;
}

export function CamposFormulario({ campos, control, metodo }: { campos: Campo[]; control: Control<Record<string, unknown>>; metodo: string }) {
  return <>{campos.map((campo) => <Controller key={campo.nome} name={campo.nome} control={control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}>
        <FieldLabel htmlFor={`${metodo}-${campo.nome}`}>{campo.rotulo}</FieldLabel>
        {campo.tipo === "lista" ? <ListaItens rotulo={campo.rotulo} value={(field.value ?? []) as Parameters<typeof ListaItens>[0]["value"]} onChange={field.onChange} concluir={campo.concluir} marcas={campo.marcas} />
          : campo.tipo === "boolean" ? <input type="checkbox" id={`${metodo}-${campo.nome}`} checked={field.value === true} onChange={(e) => field.onChange(e.target.checked)} className="size-5 accent-primary" />
          : campo.tipo === "select" && campo.filtrarPor ? <SelectFiltrado campo={campo} filtrarPor={campo.filtrarPor} control={control} valor={field.value} aoMudar={field.onChange} id={`${metodo}-${campo.nome}`} invalido={fieldState.invalid} />
          : campo.tipo === "select" ? <select {...field} value={String(field.value ?? "")} onChange={(e) => field.onChange(e.target.value || (campo.nullable ? null : ""))} id={`${metodo}-${campo.nome}`} className="min-h-11 w-full rounded-md border bg-background px-3" aria-invalid={fieldState.invalid}><option value="">{campo.nome === "projetoPaiId" ? "Nenhum (sem dependência)" : "Selecione"}</option>{campo.opcoes?.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.nome}</option>)}</select>
          : campo.tipo === "longo" ? <textarea {...field} id={`${metodo}-${campo.nome}`} value={String(field.value ?? "")} onChange={(e) => field.onChange(e.target.value || (campo.nullable ? null : ""))} rows={4} className="w-full rounded-md border bg-background p-3" aria-invalid={fieldState.invalid} />
          : <Input {...field} id={`${metodo}-${campo.nome}`} value={String(field.value ?? "")} type={campo.tipo === "senha" ? "password" : campo.tipo === "data" ? "date" : campo.tipo === "numero" ? "number" : "text"} autoComplete={campo.tipo === "senha" ? "new-password" : "off"} aria-invalid={fieldState.invalid} onChange={(e) => field.onChange(campo.tipo === "numero" ? Number(e.target.value) : e.target.value || (campo.nullable ? null : ""))} />}
        <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
      </Field>} />)}</>;
}

function SelectFiltrado({ campo, filtrarPor, control, valor, aoMudar, id, invalido }: {
  campo: Campo; filtrarPor: NonNullable<Campo["filtrarPor"]>; control: Control<Record<string, unknown>>; valor: unknown; aoMudar: (valor: string | null) => void; id: string; invalido: boolean;
}) {
  const projeto = useWatch({ control, name: filtrarPor.campo });
  const projetoId = typeof projeto === "string" && projeto ? projeto : null;
  const opcoes = projetoId ? (campo.opcoes ?? []).filter((opcao) => opcao.projetoId === projetoId) : [];
  const atual = typeof valor === "string" && valor ? valor : null;
  const valida = atual !== null && opcoes.some((opcao) => opcao.valor === atual);
  const vazio = campo.nullable ? null : "";
  useEffect(() => {
    if (atual !== null && !valida) aoMudar(vazio);
  }, [atual, valida, vazio, aoMudar]);
  return <select id={id} value={valida && atual ? atual : ""} disabled={!projetoId} aria-invalid={invalido}
    onChange={(e) => aoMudar(e.target.value || vazio)} className="min-h-11 w-full rounded-md border bg-background px-3 disabled:opacity-60">
    <option value="">{projetoId ? "Selecione" : filtrarPor.vazio}</option>
    {opcoes.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.nome}</option>)}
  </select>;
}
