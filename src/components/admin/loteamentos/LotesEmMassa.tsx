"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { chamarApi } from "@/components/admin/comum/cliente-api";
import type { StatusLote } from "@/lib/conteudo/tipos";
import { converterArea } from "./FormularioLote";
import { ORDEM_STATUS, ROTULO_STATUS } from "./status";

type Props = {
  adminPath: string;
  loteamentoId: string;
  aoConcluir: (resumo: string) => void;
  aoCancelar: () => void;
};

function erroDeCampo(mensagem?: string) {
  return mensagem ? [{ message: mensagem }] : undefined;
}

export function LotesEmMassa({ adminPath, loteamentoId, aoConcluir, aoCancelar }: Props) {
  const [quadra, setQuadra] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState<StatusLote>("disponivel");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErroGeral(null);

    const inicio = Number(de);
    const fim = Number(ate);
    const areaM2 = converterArea(area);
    const invalidos: Record<string, string> = {};
    if (!quadra.trim()) invalidos.quadra = "Informe a quadra.";
    if (!Number.isInteger(inicio) || inicio < 1) invalidos.de = "Informe o primeiro número.";
    if (!Number.isInteger(fim) || fim < inicio) invalidos.ate = "O último número deve ser maior ou igual ao primeiro.";
    else if (fim - inicio >= 500) invalidos.ate = "Crie até 500 lotes por vez.";
    if (areaM2 === undefined) invalidos.areaM2 = "Área inválida.";
    setErros(invalidos);
    if (Object.keys(invalidos).length > 0) return;

    setSalvando(true);
    const resposta = await chamarApi<{ criados: number; ignorados: number }>(adminPath, "lotes/massa", "POST", {
      loteamentoId,
      quadra,
      de: inicio,
      ate: fim,
      areaM2,
      status,
    });
    setSalvando(false);

    if (!resposta.ok || !resposta.details) {
      setErros(resposta.erros);
      setErroGeral(resposta.erro);
      return;
    }

    const { criados, ignorados } = resposta.details;
    aoConcluir(
      `${criados} ${criados === 1 ? "lote criado" : "lotes criados"}` +
        (ignorados > 0 ? `; ${ignorados} já existiam e foram mantidos.` : "."),
    );
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4 rounded-xl border border-border bg-muted/40 p-4">
      <div>
        <h3 className="text-sm font-semibold">Adicionar vários lotes</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cria os lotes de uma quadra numerados em sequência (ex.: do 1 ao 24). Números que já existem na quadra são
          mantidos.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field data-invalid={Boolean(erros.quadra)}>
          <FieldLabel htmlFor="massa-quadra">Quadra</FieldLabel>
          <Input id="massa-quadra" value={quadra} maxLength={20} aria-invalid={Boolean(erros.quadra)} onChange={(e) => setQuadra(e.target.value)} />
          <FieldError errors={erroDeCampo(erros.quadra)} />
        </Field>
        <Field data-invalid={Boolean(erros.de)}>
          <FieldLabel htmlFor="massa-de">Do número</FieldLabel>
          <Input id="massa-de" inputMode="numeric" value={de} aria-invalid={Boolean(erros.de)} onChange={(e) => setDe(e.target.value)} />
          <FieldError errors={erroDeCampo(erros.de)} />
        </Field>
        <Field data-invalid={Boolean(erros.ate)}>
          <FieldLabel htmlFor="massa-ate">Até o número</FieldLabel>
          <Input id="massa-ate" inputMode="numeric" value={ate} aria-invalid={Boolean(erros.ate)} onChange={(e) => setAte(e.target.value)} />
          <FieldError errors={erroDeCampo(erros.ate)} />
        </Field>
        <Field data-invalid={Boolean(erros.areaM2)}>
          <FieldLabel htmlFor="massa-area">Área (m²), se igual</FieldLabel>
          <Input id="massa-area" inputMode="decimal" value={area} aria-invalid={Boolean(erros.areaM2)} onChange={(e) => setArea(e.target.value)} />
          <FieldError errors={erroDeCampo(erros.areaM2)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="massa-status">Situação</FieldLabel>
          <Select id="massa-status" value={status} onChange={(e) => setStatus(e.target.value as StatusLote)}>
            {ORDEM_STATUS.map((opcao) => (
              <option key={opcao} value={opcao}>
                {ROTULO_STATUS[opcao]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <MensagemDeErro>{erroGeral}</MensagemDeErro>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Criando..." : "Criar lotes"}
        </Button>
        <Button type="button" variant="outline" disabled={salvando} onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
