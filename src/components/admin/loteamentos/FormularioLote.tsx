"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AvisoPublico } from "@/components/admin/comum/AvisoPublico";
import { MensagemDeErro, Select, Textarea } from "@/components/admin/comum/campos";
import { chamarApi } from "@/components/admin/comum/cliente-api";
import type { StatusLote } from "@/lib/conteudo/tipos";
import type { LoteAdmin } from "./consultas";
import { ORDEM_STATUS, ROTULO_STATUS } from "./status";

type Props = {
  adminPath: string;
  loteamentoId: string;
  // Sem `lote` cria; com `lote` edita.
  lote?: LoteAdmin;
  aoConcluir: () => void;
  aoCancelar: () => void;
};

function erroDeCampo(mensagem?: string) {
  return mensagem ? [{ message: mensagem }] : undefined;
}

export function converterArea(texto: string): number | null | undefined {
  const digitado = texto.trim();
  if (digitado === "") return null;
  const numero = Number(digitado.includes(",") ? digitado.replace(/\./g, "").replace(",", ".") : digitado);
  return Number.isFinite(numero) ? numero : undefined;
}

export function FormularioLote({ adminPath, loteamentoId, lote, aoConcluir, aoCancelar }: Props) {
  const [quadra, setQuadra] = useState(lote?.quadra ?? "");
  const [numero, setNumero] = useState(lote?.numero ?? "");
  const [area, setArea] = useState(lote?.areaM2 === null || lote === undefined ? "" : String(lote.areaM2).replace(".", ","));
  const [svgId, setSvgId] = useState(lote?.svgId ?? "");
  const [observacao, setObservacao] = useState(lote?.observacao ?? "");
  const [status, setStatus] = useState<StatusLote>(lote?.status ?? "disponivel");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErroGeral(null);

    const areaM2 = converterArea(area);
    const invalidos: Record<string, string> = {};
    if (!quadra.trim()) invalidos.quadra = "Informe a quadra.";
    if (!numero.trim()) invalidos.numero = "Informe o número.";
    if (areaM2 === undefined) invalidos.areaM2 = "Área inválida.";
    setErros(invalidos);
    if (Object.keys(invalidos).length > 0) return;

    setSalvando(true);
    const dados = { quadra, numero, areaM2, svgId, observacao };
    const resposta = lote
      ? await chamarApi(adminPath, `lotes/${lote.id}`, "PATCH", dados)
      : await chamarApi(adminPath, "lotes", "POST", { ...dados, loteamentoId, status });
    setSalvando(false);

    if (!resposta.ok) {
      setErros(resposta.erros);
      setErroGeral(resposta.erro);
      return;
    }
    aoConcluir();
  }

  const prefixo = lote?.id ?? "novo";

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4">
      <h3 className="text-sm font-semibold">{lote ? `Editar lote ${lote.quadra}-${lote.numero}` : "Adicionar lote"}</h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field data-invalid={Boolean(erros.quadra)}>
          <FieldLabel htmlFor={`${prefixo}-quadra`}>Quadra</FieldLabel>
          <Input
            id={`${prefixo}-quadra`}
            value={quadra}
            maxLength={20}
            aria-invalid={Boolean(erros.quadra)}
            onChange={(e) => setQuadra(e.target.value)}
          />
          <FieldError errors={erroDeCampo(erros.quadra)} />
        </Field>
        <Field data-invalid={Boolean(erros.numero)}>
          <FieldLabel htmlFor={`${prefixo}-numero`}>Número do lote</FieldLabel>
          <Input
            id={`${prefixo}-numero`}
            value={numero}
            maxLength={20}
            aria-invalid={Boolean(erros.numero)}
            onChange={(e) => setNumero(e.target.value)}
          />
          <FieldError errors={erroDeCampo(erros.numero)} />
        </Field>
        <Field data-invalid={Boolean(erros.areaM2)}>
          <FieldLabel htmlFor={`${prefixo}-area`}>Área (m²)</FieldLabel>
          <Input
            id={`${prefixo}-area`}
            inputMode="decimal"
            value={area}
            placeholder="Ex.: 250,50"
            aria-invalid={Boolean(erros.areaM2)}
            onChange={(e) => setArea(e.target.value)}
          />
          <FieldError errors={erroDeCampo(erros.areaM2)} />
        </Field>
        <Field data-invalid={Boolean(erros.svgId)}>
          <FieldLabel htmlFor={`${prefixo}-svg`}>Código no mapa</FieldLabel>
          <Input
            id={`${prefixo}-svg`}
            value={svgId}
            maxLength={100}
            aria-invalid={Boolean(erros.svgId)}
            onChange={(e) => setSvgId(e.target.value)}
          />
          <FieldError errors={erroDeCampo(erros.svgId)} />
        </Field>
      </div>
      <FieldDescription>
        O código no mapa é o id da forma deste lote dentro do arquivo SVG. Deixe vazio se ainda não há mapa.
      </FieldDescription>

      {!lote && (
        <Field className="sm:max-w-xs">
          <FieldLabel htmlFor={`${prefixo}-status`}>Situação</FieldLabel>
          <Select id={`${prefixo}-status`} value={status} onChange={(e) => setStatus(e.target.value as StatusLote)}>
            {ORDEM_STATUS.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_STATUS[opcao]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field data-invalid={Boolean(erros.observacao)}>
        <FieldLabel htmlFor={`${prefixo}-obs`}>Observação (aparece no site)</FieldLabel>
        <Textarea
          id={`${prefixo}-obs`}
          value={observacao}
          maxLength={500}
          rows={3}
          aria-invalid={Boolean(erros.observacao)}
          onChange={(e) => setObservacao(e.target.value)}
        />
        <FieldError errors={erroDeCampo(erros.observacao)} />
      </Field>
      <AvisoPublico>Este campo aparece no site, na tabela de lotes. Não coloque nome de cliente nem anotação interna aqui.</AvisoPublico>

      <MensagemDeErro>{erroGeral}</MensagemDeErro>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando..." : lote ? "Salvar lote" : "Adicionar lote"}
        </Button>
        <Button type="button" variant="outline" disabled={salvando} onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
