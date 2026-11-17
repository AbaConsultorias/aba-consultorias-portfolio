"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { codigoDoContrato, formatarDataCivil, nomeParcela } from "@/lib/portal/financeiro/regras";
import type { EventoFinanceiro, ItemFinanceiroPortal, MarcosDoProjeto, TipoEvento } from "@/lib/portal/financeiro/tipos";
import { TIPOS_EVENTO } from "@/lib/portal/financeiro/tipos";
import "@/components/portal/financeiro/financeiro.css";
import type { ProjetoOpcao } from "./EditorContrato";
import { chamarPortal } from "./requisicao";
import { ROTULO_EVENTO, ROTULO_ORIGEM } from "./rotulos";

type TipoMarcavel = Exclude<TipoEvento, "assinatura">;
const TIPOS_MARCAVEIS: readonly TipoMarcavel[] = TIPOS_EVENTO.filter((tipo): tipo is TipoMarcavel => tipo !== "assinatura");

type Formulario = { tipo: TipoMarcavel; projetoId: string; alvoEntrega: string; parcelaId: string; data: string };

type Props = {
  adminPath: string;
  empreendimentoId: string;
  eventos: readonly EventoFinanceiro[];
  contratos: readonly ItemFinanceiroPortal[];
  projetos: readonly ProjetoOpcao[];
  marcos: readonly MarcosDoProjeto[];
  hoje: string;
  somenteLeitura: boolean;
};

const formatarInstante = (instante: string) => new Date(instante).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function LinhaEvento({ evento, alvo, adminPath, podeDesfazer }: { evento: EventoFinanceiro; alvo: string | null; adminPath: string; podeDesfazer: boolean }) {
  const router = useRouter();
  const [desfazendo, setDesfazendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function desfazer() {
    setDesfazendo(true);
    setErro(null);
    const resposta = await chamarPortal(adminPath, "financeiro-eventos", "DELETE", { id: evento.id });
    setDesfazendo(false);
    if (!resposta.ok) return setErro(resposta.erro);
    router.refresh();
  }

  const desfeito = evento.desfeitoEm !== null;
  return (
    <li className="fin-evento" data-desfeito={desfeito || undefined}>
      <div className="fin-evento-texto">
        <strong>{ROTULO_EVENTO[evento.tipo]}{alvo ? ` · ${alvo}` : ""}</strong>
        <span>
          {formatarDataCivil(evento.ocorridoEm)} · {ROTULO_ORIGEM[evento.origem]} · {evento.criadoPorNome ?? "Automático"}
          {desfeito && evento.desfeitoEm ? ` · desfeito em ${formatarInstante(evento.desfeitoEm)}` : ""}
        </span>
        <MensagemDeErro>{erro}</MensagemDeErro>
      </div>
      {podeDesfazer && !desfeito && evento.tipo !== "assinatura" && (
        <Button type="button" variant="outline" size="sm" disabled={desfazendo} onClick={desfazer}>
          <Undo2 aria-hidden="true" />{desfazendo ? "Desfazendo..." : "Desfazer"}
        </Button>
      )}
    </li>
  );
}

export function SecaoEventos({ adminPath, empreendimentoId, eventos, contratos, projetos, marcos, hoje, somenteLeitura }: Props) {
  const router = useRouter();
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmarSubstituicao, setConfirmarSubstituicao] = useState<EventoFinanceiro | null>(null);

  const ativos = eventos.filter((evento) => evento.desfeitoEm === null);
  const nomeProjeto = (id: string | null) => projetos.find((projeto) => projeto.id === id)?.nome ?? "projeto";
  const contratoPorId = (id: string | null) => contratos.find((contrato) => contrato.id === id);
  const parcelasEventoOutro = contratos.flatMap((contrato) => contrato.parcelas
    .map((parcela, indice) => ({ contrato, parcela, posicao: indice + 1 }))
    .filter(({ parcela }) => parcela.gatilho === "evento" && parcela.eventoTipo === "outro"));

  function descreverAlvo(evento: EventoFinanceiro): string | null {
    if (evento.projetoId) return nomeProjeto(evento.projetoId);
    const contrato = contratoPorId(evento.itemId);
    if (contrato) return `contrato ${codigoDoContrato(contrato) ?? contrato.descricao}`;
    const achada = parcelasEventoOutro.find(({ parcela }) => parcela.id === evento.parcelaId);
    if (achada) return `${nomeParcela(achada.parcela, achada.posicao)} (${achada.parcela.eventoDescricao ?? "outro"})`;
    return null;
  }

  const projetosDosContratos = new Map(contratos.flatMap((contrato) => contrato.projetos).map((projeto) => [projeto.id, projeto.nome]));
  const avisos = [...projetosDosContratos].flatMap(([projetoId, nome]) => {
    const marco = marcos.find((candidato) => candidato.projetoId === projetoId);
    const semEvento = (tipo: TipoEvento) => !ativos.some((evento) => evento.tipo === tipo && evento.projetoId === projetoId);
    const lista: { chave: string; texto: string; acao: string; tipo: TipoMarcavel; projetoId: string }[] = [];
    if (marco?.emAnalise && semEvento("protocolo")) {
      lista.push({ chave: `protocolo-${projetoId}`, texto: `${nome} está em análise, mas sem data: marque o protocolo`, acao: "Marcar protocolo", tipo: "protocolo", projetoId });
    }
    if (marco?.aprovado && semEvento("aprovacao")) {
      lista.push({ chave: `aprovacao-${projetoId}`, texto: `${nome} está Aprovado, mas sem data: marque a aprovação`, acao: "Marcar aprovação", tipo: "aprovacao", projetoId });
    }
    return lista;
  });

  const alvosDeEntrega = contratos.flatMap((contrato) => [
    { valor: `i:${contrato.id}`, rotulo: `Entrega do contrato ${codigoDoContrato(contrato) ?? contrato.descricao}` },
    ...contrato.projetos.map((projeto) => ({ valor: `p:${projeto.id}`, rotulo: `Entrega: ${projeto.nome} (${codigoDoContrato(contrato) ?? contrato.descricao})` })),
  ]);

  function abrir(preset: Partial<Formulario>) {
    setErro(null);
    setConfirmarSubstituicao(null);
    setFormulario({ tipo: "doacoes_protocolo", projetoId: "", alvoEntrega: "", parcelaId: "", data: hoje, ...preset });
  }

  function alvoDoFormulario(f: Formulario) {
    if (f.tipo === "protocolo" || f.tipo === "aprovacao") return { projetoId: f.projetoId || null, itemId: null, parcelaId: null };
    if (f.tipo === "entrega") {
      return {
        projetoId: f.alvoEntrega.startsWith("p:") ? f.alvoEntrega.slice(2) : null,
        itemId: f.alvoEntrega.startsWith("i:") ? f.alvoEntrega.slice(2) : null,
        parcelaId: null,
      };
    }
    if (f.tipo === "outro") return { projetoId: null, itemId: null, parcelaId: f.parcelaId || null };
    return { projetoId: null, itemId: null, parcelaId: null };
  }

  async function enviar(substituir: boolean) {
    if (!formulario) return;
    setErro(null);
    const alvo = alvoDoFormulario(formulario);
    const alvoCompleto = formulario.tipo === "entrega" ? alvo.projetoId !== null || alvo.itemId !== null
      : formulario.tipo === "protocolo" || formulario.tipo === "aprovacao" ? alvo.projetoId !== null
        : formulario.tipo === "outro" ? alvo.parcelaId !== null : true;
    if (!alvoCompleto) return setErro("Escolha a que o evento se refere.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formulario.data)) return setErro("Informe a data do evento.");

    const existente = ativos.find((evento) => evento.tipo === formulario.tipo && evento.projetoId === alvo.projetoId
      && evento.itemId === alvo.itemId && evento.parcelaId === alvo.parcelaId);
    if (existente && !substituir) return setConfirmarSubstituicao(existente);

    setEnviando(true);
    const resposta = await chamarPortal(adminPath, "financeiro-eventos", "POST", {
      empreendimentoId, tipo: formulario.tipo, data: formulario.data, ...alvo, substituir,
    });
    setEnviando(false);
    if (!resposta.ok) return setErro(resposta.erro);
    setFormulario(null);
    setConfirmarSubstituicao(null);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="titulo-eventos">
      <h3 id="titulo-eventos" className="text-xl font-medium">Eventos do empreendimento</h3>
      <p className="portal-descricao">O que já aconteceu e libera o vencimento das parcelas por evento. Os de protocolo e aprovação vêm das etapas dos projetos.</p>

      {!somenteLeitura && avisos.map((aviso) => (
        <p key={aviso.chave} role="status" className="fin-aviso" data-estado="vence-em-breve">
          <TriangleAlert size={20} aria-hidden="true" />
          <span>
            {aviso.texto}.{" "}
            <Button type="button" variant="outline" size="sm" onClick={() => abrir({ tipo: aviso.tipo, projetoId: aviso.projetoId })}>{aviso.acao}</Button>
          </span>
        </p>
      ))}

      {!somenteLeitura && (
        <div className="fin-admin-acoes">
          <Button type="button" size="sm" onClick={() => abrir({})}><CalendarCheck aria-hidden="true" />Marcar como ocorrido</Button>
          {alvosDeEntrega.length > 0 && (
            <Select aria-label="Marcar entrega" className="fin-seletor-entrega" value="" onChange={(e) => e.target.value && abrir({ tipo: "entrega", alvoEntrega: e.target.value })}>
              <option value="">Marcar entrega…</option>
              {alvosDeEntrega.map((alvo) => <option key={alvo.valor} value={alvo.valor}>{alvo.rotulo}</option>)}
            </Select>
          )}
        </div>
      )}

      {formulario && (
        <Card className="p-5">
          <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void enviar(false); }}>
            <div className="fin-admin-grade">
              <Field>
                <FieldLabel htmlFor="evento-tipo">Evento</FieldLabel>
                <Select id="evento-tipo" value={formulario.tipo}
                  onChange={(e) => { setConfirmarSubstituicao(null); setFormulario({ ...formulario, tipo: TIPOS_MARCAVEIS.find((tipo) => tipo === e.target.value) ?? "outro" }); }}>
                  {TIPOS_MARCAVEIS.map((tipo) => <option key={tipo} value={tipo}>{ROTULO_EVENTO[tipo]}</option>)}
                </Select>
              </Field>
              {(formulario.tipo === "protocolo" || formulario.tipo === "aprovacao") && (
                <Field>
                  <FieldLabel htmlFor="evento-projeto">Projeto</FieldLabel>
                  <Select id="evento-projeto" value={formulario.projetoId} onChange={(e) => { setConfirmarSubstituicao(null); setFormulario({ ...formulario, projetoId: e.target.value }); }}>
                    <option value="">Escolha o projeto</option>
                    {projetos.map((projeto) => <option key={projeto.id} value={projeto.id}>{projeto.nome}</option>)}
                  </Select>
                </Field>
              )}
              {formulario.tipo === "entrega" && (
                <Field>
                  <FieldLabel htmlFor="evento-entrega">Entrega de</FieldLabel>
                  <Select id="evento-entrega" value={formulario.alvoEntrega} onChange={(e) => { setConfirmarSubstituicao(null); setFormulario({ ...formulario, alvoEntrega: e.target.value }); }}>
                    <option value="">Escolha o projeto ou o contrato</option>
                    {alvosDeEntrega.map((alvo) => <option key={alvo.valor} value={alvo.valor}>{alvo.rotulo}</option>)}
                  </Select>
                </Field>
              )}
              {formulario.tipo === "outro" && (
                <Field>
                  <FieldLabel htmlFor="evento-parcela">Parcela</FieldLabel>
                  <Select id="evento-parcela" value={formulario.parcelaId} onChange={(e) => { setConfirmarSubstituicao(null); setFormulario({ ...formulario, parcelaId: e.target.value }); }}>
                    <option value="">Escolha a parcela</option>
                    {parcelasEventoOutro.map(({ contrato, parcela, posicao }) => (
                      <option key={parcela.id} value={parcela.id}>
                        {codigoDoContrato(contrato) ?? contrato.descricao} · {nomeParcela(parcela, posicao)} ({parcela.eventoDescricao})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="evento-data">Data em que ocorreu</FieldLabel>
                <Input id="evento-data" type="date" max={hoje} value={formulario.data} onChange={(e) => { setConfirmarSubstituicao(null); setFormulario({ ...formulario, data: e.target.value }); }} />
              </Field>
            </div>
            {confirmarSubstituicao && (
              <p role="alert" className="fin-aviso" data-estado="vence-em-breve">
                <TriangleAlert size={20} aria-hidden="true" />
                <span>
                  Este evento já foi marcado em {formatarDataCivil(confirmarSubstituicao.ocorridoEm)}. Substituir pela nova data? Os vencimentos das parcelas serão recalculados.{" "}
                  <Button type="button" size="sm" disabled={enviando} onClick={() => void enviar(true)}>Substituir a data</Button>
                </span>
              </p>
            )}
            <MensagemDeErro>{erro}</MensagemDeErro>
            <div className="fin-admin-acoes">
              <Button type="submit" size="sm" disabled={enviando}>{enviando ? "Salvando..." : "Marcar"}</Button>
              <Button type="button" variant="outline" size="sm" disabled={enviando} onClick={() => { setFormulario(null); setConfirmarSubstituicao(null); setErro(null); }}>Cancelar</Button>
            </div>
          </form>
        </Card>
      )}

      {eventos.length === 0 ? (
        <p className="portal-descricao">Nenhum evento registrado ainda.</p>
      ) : (
        <ul className="fin-eventos">
          {eventos.map((evento) => <LinhaEvento key={evento.id} evento={evento} alvo={descreverAlvo(evento)} adminPath={adminPath} podeDesfazer={!somenteLeitura} />)}
        </ul>
      )}
    </section>
  );
}
