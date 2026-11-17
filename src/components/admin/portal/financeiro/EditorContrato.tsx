"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AvisoPublico } from "@/components/admin/comum/AvisoPublico";
import { MensagemDeErro, Select, Textarea } from "@/components/admin/comum/campos";
import {
  centavosParaCampo, converterReaisParaCentavos, formatarBRL, percentualDoContratado, projetosSugeridos, valorDoPercentual,
} from "@/lib/portal/financeiro/regras";
import type { GatilhoParcela, ItemFinanceiroPortal, ParcelaPortal, TipoEvento } from "@/lib/portal/financeiro/tipos";
import { TIPOS_EVENTO } from "@/lib/portal/financeiro/tipos";
import { eventoPedeProjeto, ROTULO_EVENTO } from "./rotulos";
import { chamarPortal } from "./requisicao";

export type DocumentoOpcao = { id: string; titulo: string };
export type ProjetoOpcao = { id: string; nome: string };

const AVISO_OBSERVACAO = "A observação do contrato fica visível ao cliente do empreendimento. Não escreva nada interno aqui.";
const TIPOS_DO_GATILHO = TIPOS_EVENTO;
const CODIGO_VALIDO = /^[0-9]{6}[A-Z]{1,4}$/;

type ParcelaEditavel = {
  chave: string;
  id?: string;
  comPagamento: boolean;
  nome: string;
  modo: "valor" | "percentual";
  valor: string;
  percentual: string;
  gatilho: GatilhoParcela;
  vencimento: string;
  eventoTipo: TipoEvento;
  eventoProjetoId: string;
  eventoDescricao: string;
  diasApos: string;
};

let sequencia = 0;
const novaChave = () => `nova-${(sequencia += 1)}`;

function parcelaVazia(): ParcelaEditavel {
  return {
    chave: novaChave(), comPagamento: false, nome: "", modo: "valor", valor: "", percentual: "", gatilho: "data", vencimento: "",
    eventoTipo: "aprovacao", eventoProjetoId: "", eventoDescricao: "", diasApos: "0",
  };
}

function deParcela(parcela: ParcelaPortal): ParcelaEditavel {
  return {
    chave: parcela.id,
    id: parcela.id,
    comPagamento: parcela.dataPagamento !== null || BigInt(parcela.valorPagoCentavos) > BigInt(0),
    nome: parcela.nome ?? "",
    modo: "valor",
    valor: centavosParaCampo(parcela.valorPrevistoCentavos),
    percentual: "",
    gatilho: parcela.gatilho,
    vencimento: parcela.vencimento ?? "",
    eventoTipo: parcela.eventoTipo ?? "aprovacao",
    eventoProjetoId: parcela.eventoProjetoId ?? "",
    eventoDescricao: parcela.eventoDescricao ?? "",
    diasApos: String(parcela.diasApos),
  };
}

function valorDaParcela(parcela: ParcelaEditavel, total: string | null): string | null {
  if (parcela.modo === "valor") return converterReaisParaCentavos(parcela.valor);
  return total === null ? null : valorDoPercentual(parcela.percentual, total);
}

export function EditorContrato({ adminPath, empreendimentoId, item, projetos, documentos, podeEscolherPdf, aoFechar }: {
  adminPath: string;
  empreendimentoId: string;
  item?: ItemFinanceiroPortal;
  projetos: readonly ProjetoOpcao[];
  documentos: readonly DocumentoOpcao[];
  podeEscolherPdf: boolean;
  aoFechar: () => void;
}) {
  const router = useRouter();
  // A versão é a que o formulário carregou: um refresh da página (ao marcar um evento) não pode trocá-la por baixo dos
  // campos antigos, senão o salvar sobrescreveria a edição de outra pessoa sem conflito.
  const [versaoLida] = useState(item?.atualizadoEm ?? null);
  const [codigo, setCodigo] = useState(item?.codigo ?? "");
  const [versao, setVersao] = useState(item?.versao === null || item === undefined ? "" : String(item.versao));
  const [descricao, setDescricao] = useState(item?.descricao ?? "");
  const [assinadoEm, setAssinadoEm] = useState(item?.assinadoEm ?? "");
  const [documentoId, setDocumentoId] = useState(item?.documentoId ?? "");
  const [total, setTotal] = useState(item ? centavosParaCampo(item.valorContratadoCentavos) : "");
  const [observacao, setObservacao] = useState(item?.observacao ?? "");
  const [selecionados, setSelecionados] = useState<string[]>(item?.projetos.map((projeto) => projeto.id) ?? []);
  const [tocouProjetos, setTocouProjetos] = useState(false);
  const [parcelas, setParcelas] = useState<ParcelaEditavel[]>(item ? item.parcelas.map(deParcela) : []);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const totalCentavos = converterReaisParaCentavos(total);
  const projetosMarcados = projetos.filter((projeto) => selecionados.includes(projeto.id));
  const opcoesDocumento = item?.documentoId && !documentos.some((documento) => documento.id === item.documentoId)
    ? [{ id: item.documentoId, titulo: "PDF já ligado ao contrato" }, ...documentos]
    : documentos;
  const somaPrevistos = parcelas.reduce((soma, parcela) => soma + BigInt(valorDaParcela(parcela, totalCentavos) ?? "0"), BigInt(0));
  const diferenca = totalCentavos === null ? null : BigInt(totalCentavos) - somaPrevistos;

  function mudarCodigo(texto: string) {
    const maiusculo = texto.toUpperCase();
    setCodigo(maiusculo);
    if (!item && !tocouProjetos) setSelecionados(projetosSugeridos(maiusculo, projetos));
  }

  function alternarProjeto(id: string) {
    setTocouProjetos(true);
    const marcado = selecionados.includes(id);
    setSelecionados(marcado ? selecionados.filter((atual) => atual !== id) : [...selecionados, id]);
    if (marcado) setParcelas(parcelas.map((parcela) => (parcela.eventoProjetoId === id ? { ...parcela, eventoProjetoId: "" } : parcela)));
  }

  function mudarParcela(chave: string, mudanca: Partial<ParcelaEditavel>) {
    setParcelas(parcelas.map((parcela) => (parcela.chave === chave ? { ...parcela, ...mudanca } : parcela)));
  }

  function mover(indice: number, passo: -1 | 1) {
    const destino = indice + passo;
    if (destino < 0 || destino >= parcelas.length) return;
    const copia = [...parcelas];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    setParcelas(copia);
  }

  function montar(): { corpo: Record<string, unknown> } | { problema: string } {
    const codigoLimpo = codigo.trim().toUpperCase();
    if (!CODIGO_VALIDO.test(codigoLimpo)) return { problema: "Informe o código do contrato no formato 260703C." };
    if (!descricao.trim()) return { problema: "Informe a descrição do contrato." };
    if (totalCentavos === null) return { problema: "Informe o valor contratado em reais, como 1.250,00." };
    if (versao.trim() !== "" && !/^[1-9]\d{0,5}$/.test(versao.trim())) return { problema: "A versão precisa ser um número a partir de 1." };
    if (parcelas.length > 60) return { problema: "Use até 60 parcelas." };

    const listadas = [];
    for (const [indice, parcela] of parcelas.entries()) {
      const rotulo = `Parcela ${indice + 1}`;
      const valor = valorDaParcela(parcela, totalCentavos);
      if (!parcela.nome.trim()) return { problema: `${rotulo}: informe o nome.` };
      if (valor === null) return { problema: `${rotulo}: informe o valor em reais ou o percentual (de 0 a 100).` };
      if (parcela.gatilho === "data") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(parcela.vencimento)) return { problema: `${rotulo}: informe a data de vencimento.` };
        listadas.push({
          id: parcela.id, nome: parcela.nome.trim(), valorPrevistoCentavos: valor, gatilho: "data", vencimento: parcela.vencimento,
          eventoTipo: null, eventoProjetoId: null, eventoDescricao: null, diasApos: 0,
        });
        continue;
      }
      const comProjeto = eventoPedeProjeto(parcela.eventoTipo);
      const dias = Number(parcela.diasApos.trim() === "" ? "0" : parcela.diasApos);
      if (!Number.isInteger(dias) || dias < 0 || dias > 3650) return { problema: `${rotulo}: os dias após o evento vão de 0 a 3650.` };
      if (comProjeto && parcela.eventoTipo !== "entrega" && !parcela.eventoProjetoId) return { problema: `${rotulo}: escolha o projeto do evento (marque os projetos do contrato acima).` };
      if (parcela.eventoTipo === "outro" && !parcela.eventoDescricao.trim()) return { problema: `${rotulo}: descreva o evento.` };
      listadas.push({
        id: parcela.id, nome: parcela.nome.trim(), valorPrevistoCentavos: valor, gatilho: "evento", vencimento: null,
        eventoTipo: parcela.eventoTipo,
        eventoProjetoId: comProjeto && parcela.eventoProjetoId ? parcela.eventoProjetoId : null,
        eventoDescricao: parcela.eventoTipo === "outro" ? parcela.eventoDescricao.trim() : null,
        diasApos: dias,
      });
    }

    return {
      corpo: {
        empreendimentoId,
        descricao: descricao.trim(),
        codigo: codigoLimpo,
        versao: versao.trim() === "" ? null : Number(versao.trim()),
        assinadoEm: assinadoEm || null,
        documentoId: documentoId || null,
        valorContratadoCentavos: totalCentavos,
        observacao,
        projetos: selecionados,
        parcelas: listadas,
      },
    };
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    const montado = montar();
    if ("problema" in montado) return setErro(montado.problema);
    setEnviando(true);
    const resposta = item
      ? await chamarPortal(adminPath, "contratos", "PATCH", { ...montado.corpo, id: item.id, atualizadoEm: versaoLida })
      : await chamarPortal(adminPath, "contratos", "POST", montado.corpo);
    setEnviando(false);
    if (!resposta.ok) return setErro(resposta.erro);
    aoFechar();
    router.refresh();
  }

  const prefixo = item ? `contrato-${item.id}` : "contrato-novo";
  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-5">
      <div className="fin-admin-grade">
        <Field>
          <FieldLabel htmlFor={`${prefixo}-codigo`}>Código do contrato</FieldLabel>
          <Input id={`${prefixo}-codigo`} placeholder="260703C" maxLength={10} value={codigo} onChange={(e) => mudarCodigo(e.target.value)} />
          <FieldDescription>Seis dígitos e a sigla do serviço. Também é o nome da pasta dos recebidos.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefixo}-versao`}>Versão (opcional)</FieldLabel>
          <Input id={`${prefixo}-versao`} inputMode="numeric" placeholder="1" value={versao} onChange={(e) => setVersao(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefixo}-descricao`}>Descrição</FieldLabel>
          <Input id={`${prefixo}-descricao`} maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefixo}-total`}>Valor contratado (R$)</FieldLabel>
          <Input id={`${prefixo}-total`} inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefixo}-assinatura`}>Data de assinatura</FieldLabel>
          <Input id={`${prefixo}-assinatura`} type="date" value={assinadoEm} onChange={(e) => setAssinadoEm(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefixo}-pdf`}>PDF do contrato assinado</FieldLabel>
          <Select id={`${prefixo}-pdf`} value={documentoId} disabled={!podeEscolherPdf} onChange={(e) => setDocumentoId(e.target.value)}>
            <option value="">Sem PDF ligado</option>
            {opcoesDocumento.map((documento) => <option key={documento.id} value={documento.id}>{documento.titulo}</option>)}
          </Select>
          {!podeEscolherPdf && <FieldDescription>Sem permissão para listar documentos: o PDF atual é mantido.</FieldDescription>}
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${prefixo}-obs`}>Observação</FieldLabel>
        <Textarea id={`${prefixo}-obs`} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </Field>
      <AvisoPublico>{AVISO_OBSERVACAO}</AvisoPublico>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Projetos que o contrato cobre</legend>
        {projetos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este empreendimento ainda não tem projetos cadastrados.</p>
        ) : (
          <div className="fin-ed-projetos">
            {projetos.map((projeto) => (
              <label key={projeto.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selecionados.includes(projeto.id)} onChange={() => alternarProjeto(projeto.id)} />
                {projeto.nome}
              </label>
            ))}
          </div>
        )}
        {!item && <FieldDescription>A sigla do código marca os projetos mais comuns; ajuste se precisar.</FieldDescription>}
      </fieldset>

      <section className="flex flex-col gap-3" aria-label="Parcelas do contrato">
        <h4 className="text-base font-medium">Parcelas</h4>
        {parcelas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parcela. Adicione ao menos uma para o cronograma de pagamentos.</p>}
        {parcelas.map((parcela, indice) => {
          const id = `${prefixo}-p-${parcela.chave}`;
          const valor = valorDaParcela(parcela, totalCentavos);
          const comProjeto = eventoPedeProjeto(parcela.eventoTipo);
          return (
            <div key={parcela.chave} className="fin-admin-parcela flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">Parcela {indice + 1}</strong>
                <span className="fin-admin-acoes">
                  <Button type="button" variant="outline" size="sm" aria-label={`Subir a parcela ${indice + 1}`} disabled={indice === 0} onClick={() => mover(indice, -1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button type="button" variant="outline" size="sm" aria-label={`Descer a parcela ${indice + 1}`} disabled={indice === parcelas.length - 1} onClick={() => mover(indice, 1)}><ArrowDown aria-hidden="true" /></Button>
                  {parcela.comPagamento
                    ? <span className="text-xs text-muted-foreground">Com pagamento: não pode ser removida</span>
                    : <Button type="button" variant="outline" size="sm" onClick={() => setParcelas(parcelas.filter((atual) => atual.chave !== parcela.chave))}><Trash2 aria-hidden="true" />Remover</Button>}
                </span>
              </div>
              <div className="fin-admin-grade">
                <Field>
                  <FieldLabel htmlFor={`${id}-nome`}>Nome</FieldLabel>
                  <Input id={`${id}-nome`} maxLength={120} placeholder="Ex.: Sinal" value={parcela.nome} onChange={(e) => mudarParcela(parcela.chave, { nome: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-valor`}>Valor</FieldLabel>
                  <div className="fin-ed-valor">
                    <Select aria-label="Informar em" value={parcela.modo} onChange={(e) => mudarParcela(parcela.chave, { modo: e.target.value === "percentual" ? "percentual" : "valor" })}>
                      <option value="valor">R$</option>
                      <option value="percentual">%</option>
                    </Select>
                    {parcela.modo === "valor"
                      ? <Input id={`${id}-valor`} inputMode="decimal" placeholder="0,00" value={parcela.valor} onChange={(e) => mudarParcela(parcela.chave, { valor: e.target.value })} />
                      : <Input id={`${id}-valor`} inputMode="decimal" placeholder="30" value={parcela.percentual} onChange={(e) => mudarParcela(parcela.chave, { percentual: e.target.value })} />}
                  </div>
                  {valor !== null && (
                    <FieldDescription>
                      {parcela.modo === "percentual" ? `= ${formatarBRL(valor)}` : totalCentavos !== null && percentualDoContratado(valor, totalCentavos) !== null ? `= ${percentualDoContratado(valor, totalCentavos)}% do contrato` : null}
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-gatilho`}>Vencimento</FieldLabel>
                  <Select id={`${id}-gatilho`} value={parcela.gatilho} onChange={(e) => mudarParcela(parcela.chave, { gatilho: e.target.value === "evento" ? "evento" : "data" })}>
                    <option value="data">Data fixa</option>
                    <option value="evento">Depois de um evento</option>
                  </Select>
                </Field>
                {parcela.gatilho === "data" ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-data`}>Data</FieldLabel>
                    <Input id={`${id}-data`} type="date" value={parcela.vencimento} onChange={(e) => mudarParcela(parcela.chave, { vencimento: e.target.value })} />
                  </Field>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor={`${id}-evento`}>Evento</FieldLabel>
                      <Select id={`${id}-evento`} value={parcela.eventoTipo} onChange={(e) => mudarParcela(parcela.chave, { eventoTipo: TIPOS_DO_GATILHO.find((tipo) => tipo === e.target.value) ?? "aprovacao" })}>
                        {TIPOS_DO_GATILHO.map((tipo) => <option key={tipo} value={tipo}>{ROTULO_EVENTO[tipo]}</option>)}
                      </Select>
                    </Field>
                    {comProjeto && (
                      <Field>
                        <FieldLabel htmlFor={`${id}-projeto`}>Projeto</FieldLabel>
                        <Select id={`${id}-projeto`} value={parcela.eventoProjetoId} onChange={(e) => mudarParcela(parcela.chave, { eventoProjetoId: e.target.value })}>
                          <option value="">{parcela.eventoTipo === "entrega" ? "Contrato inteiro (serviço)" : "Escolha o projeto"}</option>
                          {projetosMarcados.map((projeto) => <option key={projeto.id} value={projeto.id}>{projeto.nome}</option>)}
                        </Select>
                      </Field>
                    )}
                    {parcela.eventoTipo === "outro" && (
                      <Field>
                        <FieldLabel htmlFor={`${id}-descricao`}>Descreva o evento</FieldLabel>
                        <Input id={`${id}-descricao`} maxLength={120} value={parcela.eventoDescricao} onChange={(e) => mudarParcela(parcela.chave, { eventoDescricao: e.target.value })} />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor={`${id}-dias`}>Dias após o evento</FieldLabel>
                      <Input id={`${id}-dias`} inputMode="numeric" placeholder="0" value={parcela.diasApos} onChange={(e) => mudarParcela(parcela.chave, { diasApos: e.target.value })} />
                    </Field>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div><Button type="button" variant="outline" size="sm" onClick={() => setParcelas([...parcelas, parcelaVazia()])}><Plus aria-hidden="true" />Adicionar parcela</Button></div>
        {diferenca !== null && parcelas.length > 0 && diferenca !== BigInt(0) && (
          <p role="status" className="text-sm text-muted-foreground">
            Conferência: as parcelas somam {formatarBRL(somaPrevistos.toString())},
            {" "}{diferenca > BigInt(0) ? `${formatarBRL(diferenca.toString())} a menos` : `${formatarBRL((-diferenca).toString())} a mais`} que o valor contratado.
          </p>
        )}
      </section>

      <MensagemDeErro>{erro}</MensagemDeErro>
      <div className="fin-admin-acoes">
        <Button type="submit" size="sm" disabled={enviando}><Save aria-hidden="true" />{enviando ? "Salvando..." : "Salvar contrato"}</Button>
        <Button type="button" variant="outline" size="sm" disabled={enviando} onClick={aoFechar}><X aria-hidden="true" />Cancelar</Button>
      </div>
    </form>
  );
}
