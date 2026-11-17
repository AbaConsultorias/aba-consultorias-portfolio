"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MensagemDeErro, Select, Textarea } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import type { ItemDoCatalogo, SubpastasDoCatalogo } from "@/lib/conector/montagem";
import { Caixa } from "./campos";

export type ItemParaEdicao = ItemDoCatalogo & { id: string };
type Props = { adminPath: string; itens: ItemParaEdicao[]; modelos: { valor: string; nome: string }[] };

const TIPO: Record<ItemParaEdicao["tipo"], string> = {
  projeto: "Projeto", grupo: "Grupo de documentos", equipamentos: "SIMOS e Laudos", arquivo: "Pasta de arquivo (Outros projetos)",
};

// Uma linha por caminho-padrão; níveis separados por ">" e palavras por espaço. Linha vazia não conta.
const subpastasParaTexto = (subpastas: SubpastasDoCatalogo): string => subpastas.map((caminho) => caminho.map((nivel) => nivel.join(" ")).join(" > ")).join("\n");
const textoParaSubpastas = (texto: string): string[][][] =>
  texto.split("\n").map((linha) => linha.trim()).filter((linha) => linha !== "")
    .map((linha) => linha.split(">").map((nivel) => nivel.trim().split(/[\s,]+/).filter((palavra) => palavra !== "")));
const textoParaTermos = (texto: string): string[] => texto.split(/[\s,]+/).filter((palavra) => palavra !== "");

function CartaoDoItem({ adminPath, item, modelos }: { adminPath: string; item: ItemParaEdicao; modelos: Props["modelos"] }) {
  const router = useRouter();
  const [termos, setTermos] = useState(item.termos.join(" "));
  const [excluir, setExcluir] = useState(item.termosExcluir.join(" "));
  const [subpastas, setSubpastas] = useState(subpastasParaTexto(item.subpastas));
  const [nomeProjeto, setNomeProjeto] = useState(item.nomeProjeto ?? "");
  const [categoria, setCategoria] = useState(item.categoria ?? "");
  const [modeloId, setModeloId] = useState(item.modeloId ?? "");
  const [ordem, setOrdem] = useState(String(item.ordem));
  const [ativo, setAtivo] = useState(item.ativo);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const ehProjeto = item.tipo === "projeto";
  const id = `catalogo-${item.chave}`;

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const ordemNumero = Number(ordem);
    if (!Number.isInteger(ordemNumero) || ordemNumero < 0 || ordemNumero > 1000) {
      setErro("A ordem é um número inteiro de 0 a 1000.");
      return;
    }
    if (ehProjeto && nomeProjeto.trim() === "") {
      setErro("Informe o nome do projeto.");
      return;
    }
    setOcupado(true);
    setErro("");
    setAviso("");
    const resposta = await chamarPortal(adminPath, "catalogo-pastas", "PATCH", {
      id: item.id,
      termos: textoParaTermos(termos),
      termosExcluir: textoParaTermos(excluir),
      subpastas: textoParaSubpastas(subpastas),
      ...(ehProjeto ? { nomeProjeto: nomeProjeto.trim(), categoria: categoria.trim() === "" ? null : categoria.trim(), modeloId: modeloId === "" ? null : modeloId } : {}),
      ativo,
      ordem: ordemNumero,
    });
    setOcupado(false);
    if (!resposta.ok) {
      setErro(Object.values(resposta.erros)[0] ?? resposta.erro ?? "Não foi possível salvar.");
      return;
    }
    setAviso("Item salvo.");
    router.refresh();
  }

  return (
    <form onSubmit={salvar} noValidate aria-label={item.rotulo} className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-medium [overflow-wrap:anywhere]">{item.rotulo}</h2>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {TIPO[item.tipo]} · fase {item.fase === "base" ? "base" : "complementar"} · chave “{item.chave}” · pasta de primeiro nível “{item.raiz}”
          {item.dependeDe ? ` · depende de ${item.dependeDe === "sistema" ? "SAA ou SES (pelo nome da pasta)" : item.dependeDe}` : ""}
          {item.destinoEquipamentos ? ` · recebe no projeto “${item.destinoEquipamentos}”` : ""}
          {item.tipo === "projeto" && !item.criaRegras ? " · cria só o projeto, sem regra (os arquivos da pasta vão para o projeto de que ele depende)" : ""}
        </p>
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field className="min-w-0">
          <FieldLabel htmlFor={`${id}-termos`}>Palavras que todas precisam aparecer no nome da pasta</FieldLabel>
          <Input id={`${id}-termos`} value={termos} disabled={ocupado} autoComplete="off" onChange={(evento) => setTermos(evento.target.value)} />
        </Field>
        <Field className="min-w-0">
          <FieldLabel htmlFor={`${id}-excluir`}>Palavras que não podem aparecer</FieldLabel>
          <Input id={`${id}-excluir`} value={excluir} disabled={ocupado} autoComplete="off" onChange={(evento) => setExcluir(evento.target.value)} />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">Sem acento, separadas por espaço. “*” no fim vale como prefixo (APROVAD* casa APROVADO e APROVADA).</p>

      <Field className="min-w-0">
        <FieldLabel htmlFor={`${id}-subpastas`}>Subpastas que valem (uma por linha)</FieldLabel>
        <Textarea id={`${id}-subpastas`} value={subpastas} rows={3} disabled={ocupado} aria-describedby={`${id}-subpastas-ajuda`} onChange={(evento) => setSubpastas(evento.target.value)} />
        <p id={`${id}-subpastas-ajuda`} className="text-sm text-muted-foreground">Cada linha é um caminho; separe os níveis com “&gt;” (ex.: BENS IMOVEIS &gt; DESONERACAO). Vazio = a própria pasta.</p>
      </Field>

      {ehProjeto && (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${id}-nome`}>Nome do projeto</FieldLabel>
            <Input id={`${id}-nome`} value={nomeProjeto} maxLength={160} disabled={ocupado} autoComplete="off" onChange={(evento) => setNomeProjeto(evento.target.value)} />
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${id}-categoria`}>Categoria que recebe os documentos</FieldLabel>
            <Input id={`${id}-categoria`} value={categoria} maxLength={120} disabled={ocupado} autoComplete="off" onChange={(evento) => setCategoria(evento.target.value)} />
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${id}-modelo`}>Modelo de projeto</FieldLabel>
            <Select id={`${id}-modelo`} value={modeloId} disabled={ocupado} onChange={(evento) => setModeloId(evento.target.value)}>
              <option value="">Sem modelo (o item não cria projeto)</option>
              {modelos.map((modelo) => <option key={modelo.valor} value={modelo.valor}>{modelo.nome}</option>)}
            </Select>
          </Field>
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
        <Field className="w-32">
          <FieldLabel htmlFor={`${id}-ordem`}>Ordem</FieldLabel>
          <Input id={`${id}-ordem`} value={ordem} inputMode="numeric" disabled={ocupado} onChange={(evento) => setOrdem(evento.target.value)} />
        </Field>
        <Caixa marcada={ativo} aoMudar={setAtivo} desabilitada={ocupado}>Ativo (item inativo não aparece na montagem)</Caixa>
      </div>

      <Button type="submit" className="portal-botao" disabled={ocupado}><Save aria-hidden="true" />{ocupado ? "Salvando…" : "Salvar item"}</Button>
      <MensagemDeErro>{erro}</MensagemDeErro>
      <p role="status" aria-live="polite" className="text-sm">{aviso}</p>
    </form>
  );
}

export function EditorDoCatalogo({ adminPath, itens, modelos }: Props) {
  return (
    <div className="min-w-0 space-y-4">
      {itens.map((item) => <CartaoDoItem key={item.id} adminPath={adminPath} item={item} modelos={modelos} />)}
    </div>
  );
}
