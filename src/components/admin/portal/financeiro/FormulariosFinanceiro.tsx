"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Save, X } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AvisoPublico } from "@/components/admin/comum/AvisoPublico";
import { MensagemDeErro, Select, Textarea } from "@/components/admin/comum/campos";
import { centavosParaCampo, converterReaisParaCentavos, percentualDoContratado, valorDoPercentual } from "@/lib/portal/financeiro/regras";
import type { ItemFinanceiroPortal, ParcelaPortal } from "@/lib/portal/financeiro/tipos";
import { chamarPortal } from "./requisicao";

export type FornecedorOpcao = { id: string; nome: string; ativo: boolean };

const AVISO_OBSERVACAO = "A observação fica visível ao cliente do empreendimento e ao fornecedor do item. Não escreva nada interno aqui.";
// A tela do cliente não mostra a observação da parcela, mas o banco ainda a entrega a ele: nada sigiloso aqui.
const AVISO_OBSERVACAO_CONTRATO = "O portal do cliente não mostra esta observação, mas ela não é sigilosa: não escreva nada interno aqui.";

const valorReais = z.string().refine((v) => converterReaisParaCentavos(v) !== null, "Informe um valor em reais, como 1.250,00.");
const dataOpcional = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.")]);

const itemSchema = z.object({
  descricao: z.string().trim().min(2, "Informe ao menos 2 caracteres.").max(160, "Use até 160 caracteres."),
  fornecedorId: z.string().min(1, "Escolha um fornecedor."),
  valor: valorReais,
  observacao: z.string().max(5000, "Use até 5000 caracteres."),
});
type ItemValores = z.infer<typeof itemSchema>;

const parcelaSchema = z.object({
  nome: z.string().trim().max(120, "Use até 120 caracteres."),
  percentual: z.string().refine((v) => v.trim() === "" || valorDoPercentual(v, "100") !== null, "Informe um percentual entre 0 e 100, como 25 ou 12,5."),
  vencimento: dataOpcional,
  previsto: valorReais,
  pago: valorReais,
  dataPagamento: dataOpcional,
  observacao: z.string().max(5000, "Use até 5000 caracteres."),
  corrigir: z.boolean(),
});
type ParcelaValores = z.infer<typeof parcelaSchema>;

function ErroCampo({ mensagem }: { mensagem?: string }) {
  return <FieldError errors={mensagem ? [{ message: mensagem }] : undefined} />;
}

type RodapeProps = { enviando: boolean; erro: string | null; aoCancelar: () => void };

function Rodape({ enviando, erro, aoCancelar }: RodapeProps) {
  return (
    <>
      <MensagemDeErro>{erro}</MensagemDeErro>
      <div className="fin-admin-acoes">
        <Button type="submit" size="sm" disabled={enviando}><Save aria-hidden="true" />{enviando ? "Salvando..." : "Salvar"}</Button>
        <Button type="button" variant="outline" size="sm" disabled={enviando} onClick={aoCancelar}><X aria-hidden="true" />Cancelar</Button>
      </div>
    </>
  );
}

export function FormularioItem({ adminPath, empreendimentoId, item, observacao, fornecedores, aoFechar }: {
  adminPath: string;
  empreendimentoId: string;
  item?: ItemFinanceiroPortal;
  fornecedores: readonly FornecedorOpcao[];
  observacao?: string;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ItemValores>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      descricao: item?.descricao ?? "",
      fornecedorId: item?.fornecedorId ?? "",
      valor: item ? centavosParaCampo(item.valorContratadoCentavos) : "",
      observacao: observacao ?? item?.observacao ?? "",
    },
  });
  const prefixo = item ? `item-${item.id}` : "item-novo";
  const opcoes = fornecedores.filter((f) => f.ativo || f.id === item?.fornecedorId);

  async function enviar(valores: ItemValores) {
    setErro(null);
    const campos = {
      fornecedorId: valores.fornecedorId,
      descricao: valores.descricao,
      valorContratadoCentavos: converterReaisParaCentavos(valores.valor),
      observacao: valores.observacao,
    };
    const resposta = item
      ? await chamarPortal(adminPath, "itens-financeiros", "PATCH", { id: item.id, ...campos })
      : await chamarPortal(adminPath, "itens-financeiros", "POST", { empreendimentoId, ...campos });
    if (!resposta.ok) {
      setErro(resposta.erro);
      if (resposta.erros.descricao) setError("descricao", { message: resposta.erros.descricao });
      return;
    }
    aoFechar();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(enviar)} noValidate className="flex flex-col gap-4">
      <div className="fin-admin-grade">
        <Field data-invalid={Boolean(errors.descricao)}>
          <FieldLabel htmlFor={`${prefixo}-descricao`}>Descrição</FieldLabel>
          <Input id={`${prefixo}-descricao`} aria-invalid={Boolean(errors.descricao)} {...register("descricao")} />
          <ErroCampo mensagem={errors.descricao?.message} />
        </Field>
        <Field data-invalid={Boolean(errors.valor)}>
          <FieldLabel htmlFor={`${prefixo}-valor`}>Valor contratado (R$)</FieldLabel>
          <Input id={`${prefixo}-valor`} inputMode="decimal" placeholder="0,00" aria-invalid={Boolean(errors.valor)} {...register("valor")} />
          <ErroCampo mensagem={errors.valor?.message} />
        </Field>
        <Field data-invalid={Boolean(errors.fornecedorId)}>
          <FieldLabel htmlFor={`${prefixo}-fornecedor`}>Fornecedor</FieldLabel>
          <Select id={`${prefixo}-fornecedor`} aria-invalid={Boolean(errors.fornecedorId)} {...register("fornecedorId")}>
            <option value="">Escolha o fornecedor</option>
            {opcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.ativo ? "" : " (inativo)"}</option>)}
          </Select>
          <ErroCampo mensagem={errors.fornecedorId?.message} />
        </Field>
      </div>
      <Field data-invalid={Boolean(errors.observacao)}>
        <FieldLabel htmlFor={`${prefixo}-obs`}>Observação</FieldLabel>
        <Textarea id={`${prefixo}-obs`} aria-invalid={Boolean(errors.observacao)} {...register("observacao")} />
        <ErroCampo mensagem={errors.observacao?.message} />
      </Field>
      <AvisoPublico>{AVISO_OBSERVACAO}</AvisoPublico>
      <Rodape enviando={isSubmitting} erro={erro} aoCancelar={aoFechar} />
    </form>
  );
}

// `somentePagamento`: parcela por evento, cujo nome, valor e vencimento só mudam ao salvar o contrato.
// `ehContrato`: a observação da parcela de contrato da ABA é interna (o cliente não a recebe).
export function FormularioParcela({ adminPath, itemId, contratado, posicao, parcela, observacao, somentePagamento = false, ehContrato = false, aoFechar }: {
  adminPath: string;
  itemId: string;
  contratado: string;
  posicao: number;
  parcela?: ParcelaPortal;
  observacao?: string | null;
  somentePagamento?: boolean;
  ehContrato?: boolean;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const { register, handleSubmit, control, setValue, setError, formState: { errors, isSubmitting } } = useForm<ParcelaValores>({
    resolver: zodResolver(parcelaSchema),
    defaultValues: {
      nome: parcela?.nome ?? "",
      percentual: parcela ? percentualDoContratado(parcela.valorPrevistoCentavos, contratado) ?? "" : "",
      vencimento: parcela?.vencimento ?? "",
      previsto: parcela ? centavosParaCampo(parcela.valorPrevistoCentavos) : "",
      pago: centavosParaCampo(parcela?.valorPagoCentavos ?? "0"),
      dataPagamento: parcela?.dataPagamento ?? "",
      observacao: observacao ?? "",
      corrigir: false,
    },
  });
  const prefixo = parcela ? `parcela-${parcela.id}` : `parcela-nova-${itemId}`;
  const pagoAtual = parcela ? BigInt(parcela.valorPagoCentavos) : BigInt(0);
  const pagoDigitado = useWatch({ control, name: "pago" });
  const dataDigitada = useWatch({ control, name: "dataPagamento" });
  const pagoNovo = converterReaisParaCentavos(pagoDigitado);
  const reduz = Boolean(parcela) && (
    (pagoNovo !== null && BigInt(pagoNovo) < pagoAtual) || (parcela?.dataPagamento != null && dataDigitada === "")
  );

  // Percentual e valor previsto andam juntos: quem for digitado preenche o outro.
  const semContratado = BigInt(contratado) <= BigInt(0);
  function aoMudarPercentual(texto: string) {
    const valor = valorDoPercentual(texto, contratado);
    if (valor !== null) setValue("previsto", centavosParaCampo(valor), { shouldValidate: true });
  }
  function aoMudarPrevisto(texto: string) {
    const valor = converterReaisParaCentavos(texto);
    setValue("percentual", valor === null ? "" : percentualDoContratado(valor, contratado) ?? "", { shouldValidate: true });
  }

  async function enviar(v: ParcelaValores) {
    setErro(null);
    if (!somentePagamento && !v.vencimento) return setError("vencimento", { message: "Informe uma data válida." });
    const resposta = parcela
      ? await chamarPortal(adminPath, "parcelas", "PATCH", {
        id: parcela.id,
        nome: v.nome,
        vencimento: v.vencimento || null,
        valorPrevistoCentavos: converterReaisParaCentavos(v.previsto),
        valorPagoCentavos: converterReaisParaCentavos(v.pago),
        dataPagamento: v.dataPagamento || null,
        observacao: v.observacao,
        corrigir: v.corrigir,
      })
      : await chamarPortal(adminPath, "parcelas", "POST", {
        itemId, nome: v.nome, vencimento: v.vencimento, valorPrevistoCentavos: converterReaisParaCentavos(v.previsto), observacao: v.observacao,
      });
    if (!resposta.ok) return setErro(resposta.erro);
    aoFechar();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(enviar)} noValidate className="flex flex-col gap-4">
      <div className="fin-admin-grade">
        {!somentePagamento && (
          <>
            <Field data-invalid={Boolean(errors.nome)}>
              <FieldLabel htmlFor={`${prefixo}-nome`}>Nome da parcela (opcional)</FieldLabel>
              <Input id={`${prefixo}-nome`} placeholder={`${posicao}ª parcela`} aria-invalid={Boolean(errors.nome)} {...register("nome")} />
              <ErroCampo mensagem={errors.nome?.message} />
            </Field>
            <Field data-invalid={Boolean(errors.vencimento)}>
              <FieldLabel htmlFor={`${prefixo}-venc`}>Vencimento</FieldLabel>
              <Input id={`${prefixo}-venc`} type="date" aria-invalid={Boolean(errors.vencimento)} {...register("vencimento")} />
              <ErroCampo mensagem={errors.vencimento?.message} />
            </Field>
            <Field data-invalid={Boolean(errors.previsto)}>
              <FieldLabel htmlFor={`${prefixo}-prev`}>Valor previsto (R$)</FieldLabel>
              <Input id={`${prefixo}-prev`} inputMode="decimal" placeholder="0,00" aria-invalid={Boolean(errors.previsto)}
                {...register("previsto", { onChange: (e) => aoMudarPrevisto(e.target.value) })} />
              <ErroCampo mensagem={errors.previsto?.message} />
            </Field>
            <Field data-invalid={Boolean(errors.percentual)}>
              <FieldLabel htmlFor={`${prefixo}-pct`}>Percentual do contratado (opcional)</FieldLabel>
              <Input id={`${prefixo}-pct`} inputMode="decimal" placeholder={semContratado ? "Item sem valor contratado" : "0"} disabled={semContratado}
                aria-invalid={Boolean(errors.percentual)} {...register("percentual", { onChange: (e) => aoMudarPercentual(e.target.value) })} />
              <ErroCampo mensagem={errors.percentual?.message} />
            </Field>
          </>
        )}
        {parcela && (
          <>
            <Field data-invalid={Boolean(errors.pago)}>
              <FieldLabel htmlFor={`${prefixo}-pago`}>Total pago até agora (R$)</FieldLabel>
              <Input id={`${prefixo}-pago`} inputMode="decimal" placeholder="0,00" aria-invalid={Boolean(errors.pago)} {...register("pago")} />
              <ErroCampo mensagem={errors.pago?.message} />
            </Field>
            <Field data-invalid={Boolean(errors.dataPagamento)}>
              <FieldLabel htmlFor={`${prefixo}-data`}>Data da quitação</FieldLabel>
              <Input id={`${prefixo}-data`} type="date" aria-invalid={Boolean(errors.dataPagamento)} {...register("dataPagamento")} />
              <ErroCampo mensagem={errors.dataPagamento?.message} />
            </Field>
          </>
        )}
      </div>
      {parcela && (
        <FieldDescription>
          Informe o total já pago, não apenas o valor de hoje: salvar de novo não soma duas vezes. Pagamento parcial deixa a data vazia;
          preencher a data quita a parcela, mesmo que o valor pago seja menor que o previsto.
        </FieldDescription>
      )}
      {reduz && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" {...register("corrigir")} />
          <span>Confirmo que é uma correção: o pagamento registrado será reduzido ou a quitação desfeita (a alteração fica na auditoria).</span>
        </label>
      )}
      <Field data-invalid={Boolean(errors.observacao)}>
        <FieldLabel htmlFor={`${prefixo}-obs`}>Observação</FieldLabel>
        <Textarea id={`${prefixo}-obs`} aria-invalid={Boolean(errors.observacao)} {...register("observacao")} />
        <ErroCampo mensagem={errors.observacao?.message} />
      </Field>
      <AvisoPublico>{ehContrato ? AVISO_OBSERVACAO_CONTRATO : AVISO_OBSERVACAO}</AvisoPublico>
      <Rodape enviando={isSubmitting} erro={erro} aoCancelar={aoFechar} />
    </form>
  );
}
