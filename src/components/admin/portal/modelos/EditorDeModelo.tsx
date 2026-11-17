"use client";
import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { MensagemDeErro, Select, Textarea } from "@/components/admin/comum/campos";
import { Caixa } from "@/components/admin/portal/pasta/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { MARCOS_DE_ETAPA, ROTULO_DO_MARCO, type MarcoDeEtapa } from "@/app/api/(modules)/adm-interno/portal/modelos/schema";
import { porOrdem, type Modelo } from "./tipos";

type Linha = { chave: string; id?: string; nome: string; marco: MarcoDeEtapa | null };

const LIMITE_DE_ITENS = 100;
// Sugestão para um modelo novo; a pessoa ajusta os nomes à vontade.
const ETAPAS_PADRAO: { nome: string; marco: MarcoDeEtapa | null }[] = [
  { nome: "Não Iniciado", marco: null },
  { nome: "Em confecção", marco: "confeccao" },
  { nome: "Em análise da Copasa", marco: "analise" },
  { nome: "Aprovado", marco: "aprovado" },
];
const marcoDoValor = (valor: string): MarcoDeEtapa | null => MARCOS_DE_ETAPA.find((marco) => marco === valor) ?? null;

export function EditorDeModelo({ adminPath, modelo, aoSalvar, aoCancelar }: {
  adminPath: string; modelo: Modelo | null; aoSalvar: (mensagem: string) => void; aoCancelar: () => void;
}) {
  const base = useId();
  // Chave só para o React manter cada linha estável ao reordenar; nunca vai para o servidor.
  const novaChave = () => crypto.randomUUID();
  const [nome, setNome] = useState(modelo?.nome ?? "");
  const [descricao, setDescricao] = useState(modelo?.descricao ?? "");
  const [ativo, setAtivo] = useState(modelo?.ativo ?? true);
  const [etapas, setEtapas] = useState<Linha[]>(() => porOrdem(modelo?.etapas ?? []).map((etapa, indice) => ({ chave: `etapa-${etapa.id ?? indice}`, id: etapa.id, nome: etapa.nome, marco: etapa.marco })));
  const [categorias, setCategorias] = useState<Linha[]>(() => porOrdem(modelo?.categorias ?? []).map((categoria, indice) => ({ chave: `categoria-${categoria.id ?? indice}`, id: categoria.id, nome: categoria.nome, marco: null })));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [tentou, setTentou] = useState(false);

  const nomeInvalido = nome.trim().length < 2;
  const etapaInvalida = (linha: Linha) => linha.nome.trim().length < 2;

  async function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setTentou(true);
    setErro("");
    if (nomeInvalido) { setErro("Dê um nome ao modelo (pelo menos 2 letras)."); return; }
    if (etapas.some(etapaInvalida)) { setErro("Toda etapa precisa de um nome com pelo menos 2 letras."); return; }
    if (categorias.some(etapaInvalida)) { setErro("Toda categoria precisa de um nome com pelo menos 2 letras."); return; }
    const corpo = {
      ...(modelo ? { id: modelo.id } : {}),
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      ativo,
      etapas: etapas.map((linha, ordem) => ({ ...(linha.id ? { id: linha.id } : {}), nome: linha.nome.trim(), ordem, marco: linha.marco })),
      categorias: categorias.map((linha, ordem) => ({ ...(linha.id ? { id: linha.id } : {}), nome: linha.nome.trim(), ordem })),
    };
    setOcupado(true);
    const resposta = await chamarPortal(adminPath, "modelos", modelo ? "PATCH" : "POST", corpo);
    setOcupado(false);
    if (!resposta.ok) { setErro(resposta.erro ?? "Não foi possível salvar. Nada foi alterado."); return; }
    aoSalvar(modelo ? `Modelo “${corpo.nome}” salvo.` : `Modelo “${corpo.nome}” criado.`);
  }

  return (
    <form onSubmit={salvar} noValidate aria-label={modelo ? `Editar ${modelo.nome}` : "Novo modelo"} className="min-w-0 space-y-6">
      <fieldset disabled={ocupado} className="min-w-0 space-y-6">
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${base}-nome`}>Nome do modelo</FieldLabel>
            <Input id={`${base}-nome`} value={nome} maxLength={160} autoComplete="off" aria-invalid={tentou && nomeInvalido} onChange={(evento) => setNome(evento.target.value)} />
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${base}-descricao`}>Descrição <span className="font-normal text-muted-foreground">(opcional)</span></FieldLabel>
            <Textarea id={`${base}-descricao`} value={descricao} maxLength={5000} rows={2} className="min-h-9" onChange={(evento) => setDescricao(evento.target.value)} />
          </Field>
        </div>
        <Caixa marcada={ativo} aoMudar={setAtivo}>
          <span className="font-medium">Ativo</span>
          <span className="block text-muted-foreground">Modelos inativos não aparecem na criação de projetos novos.</span>
        </Caixa>

        <ListaEditavel titulo="Etapas" singular="etapa" linhas={etapas} aoMudar={setEtapas} novaChave={novaChave} comMarca invalida={tentou ? etapaInvalida : undefined}
          ajuda="A marca liga a etapa aos arquivos das pastas do servidor: protocolo leva a “Em análise”, devolutiva a “Em confecção” e a pasta aprovada a “Aprovado”. Cada marca vale para uma só etapa."
          vazio={<Button type="button" variant="outline" className="portal-botao" onClick={() => setEtapas(ETAPAS_PADRAO.map((etapa) => ({ chave: novaChave(), ...etapa })))}>
            <Sparkles aria-hidden="true" />Começar com as etapas padrão
          </Button>} />

        <ListaEditavel titulo="Categorias de documento" singular="categoria" linhas={categorias} aoMudar={setCategorias} novaChave={novaChave} invalida={tentou ? etapaInvalida : undefined}
          ajuda="Pastas em que os documentos do projeto ficam organizados para o cliente." />

        {modelo && <p className="text-sm text-muted-foreground">Projetos já criados com este modelo não mudam: cada projeto guarda a sua cópia das etapas.</p>}
        <MensagemDeErro>{erro}</MensagemDeErro>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="portal-botao"><Save aria-hidden="true" />{ocupado ? "Salvando…" : modelo ? "Salvar alterações" : "Criar modelo"}</Button>
          <Button type="button" variant="outline" className="portal-botao" onClick={aoCancelar}><X aria-hidden="true" />Cancelar</Button>
        </div>
      </fieldset>
    </form>
  );
}

function ListaEditavel({ titulo, singular, linhas, aoMudar, novaChave, comMarca = false, invalida, ajuda, vazio }: {
  titulo: string; singular: string; linhas: Linha[]; aoMudar: (linhas: Linha[]) => void; novaChave: () => string;
  comMarca?: boolean; invalida?: (linha: Linha) => boolean; ajuda: string; vazio?: React.ReactNode;
}) {
  const idTitulo = useId();
  function mover(indice: number, delta: number) {
    const destino = indice + delta;
    if (destino < 0 || destino >= linhas.length) return;
    const proximas = [...linhas];
    [proximas[indice], proximas[destino]] = [proximas[destino], proximas[indice]];
    aoMudar(proximas);
  }
  const mudar = (indice: number, parcial: Partial<Linha>) => aoMudar(linhas.map((linha, i) => (i === indice ? { ...linha, ...parcial } : linha)));
  // Escolher uma marca já usada tira a marca da outra etapa: o banco recusa marca repetida no mesmo modelo.
  const marcar = (indice: number, marco: MarcoDeEtapa | null) =>
    aoMudar(linhas.map((linha, i) => (i === indice ? { ...linha, marco } : marco !== null && linha.marco === marco ? { ...linha, marco: null } : linha)));

  return (
    <section aria-labelledby={idTitulo} className="min-w-0 space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="space-y-1">
        <h4 id={idTitulo} className="font-medium">{titulo} <span className="font-normal text-muted-foreground">({linhas.length})</span></h4>
        <p className="text-sm text-muted-foreground">{ajuda}</p>
      </div>
      {linhas.length === 0 && vazio}
      {linhas.length > 0 && (
        <ol className="min-w-0 space-y-2">
          {linhas.map((linha, indice) => {
            const rotulo = `${singular.charAt(0).toUpperCase() + singular.slice(1)} ${indice + 1}`;
            return (
              <li key={linha.chave} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground" aria-hidden="true">{indice + 1}</span>
                <Input aria-label={rotulo} value={linha.nome} maxLength={160} autoComplete="off" placeholder={`Nome da ${singular}`} aria-invalid={invalida?.(linha) || undefined}
                  className="min-h-10 min-w-0 flex-1 basis-48" onChange={(evento) => mudar(indice, { nome: evento.target.value })} />
                {comMarca && (
                  <Select aria-label={`Marca da ${singular} ${indice + 1}`} value={linha.marco ?? ""} className="min-h-10 w-auto min-w-36 flex-none"
                    onChange={(evento) => marcar(indice, marcoDoValor(evento.target.value))}>
                    <option value="">Sem marca</option>
                    {MARCOS_DE_ETAPA.map((marco) => <option key={marco} value={marco}>{ROTULO_DO_MARCO[marco]}</option>)}
                  </Select>
                )}
                <div className="ml-auto flex shrink-0 gap-1">
                  <Button type="button" size="icon" variant="ghost" className="size-10" aria-label={`Subir ${rotulo.toLowerCase()}`} disabled={indice === 0} onClick={() => mover(indice, -1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="size-10" aria-label={`Descer ${rotulo.toLowerCase()}`} disabled={indice === linhas.length - 1} onClick={() => mover(indice, 1)}><ArrowDown aria-hidden="true" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="size-10 text-muted-foreground hover:text-destructive" aria-label={`Remover ${rotulo.toLowerCase()}`} onClick={() => aoMudar(linhas.filter((_, i) => i !== indice))}><Trash2 aria-hidden="true" /></Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <Button type="button" variant="outline" className="portal-botao" disabled={linhas.length >= LIMITE_DE_ITENS}
        onClick={() => aoMudar([...linhas, { chave: novaChave(), nome: "", marco: null }])}>
        <Plus aria-hidden="true" />Adicionar {singular}
      </Button>
    </section>
  );
}
