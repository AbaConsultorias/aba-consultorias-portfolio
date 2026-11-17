"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/admin/comum/campos";
import { ROTULO_DO_GRUPO, GRUPOS_DE_DOCUMENTO, TAMANHO_MAXIMO_DO_ROTULO } from "@/lib/conector/sugestoes";
import type { ProjetoDaPasta, TipoDeRegraDePasta } from "@/lib/portal/pasta/tipos";
import { destinoDoValor, valorDoDestino, type Destino } from "./destino";

export function Caixa({ marcada, aoMudar, desabilitada, children }: {
  marcada: boolean; aoMudar: (marcada: boolean) => void; desabilitada?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 items-start gap-2 text-sm">
      <input type="checkbox" checked={marcada} disabled={desabilitada} onChange={(evento) => aoMudar(evento.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </label>
  );
}

export const ROTULO_DO_TIPO: Record<TipoDeRegraDePasta, string> = {
  comum: "Pasta comum",
  equipamentos: "SIMOS e Laudos (por equipamento)",
  protocolos: "Protocolos",
  devolutivas: "Devolutivas da Copasa",
};

const TIPOS: readonly TipoDeRegraDePasta[] = ["comum", "equipamentos", "protocolos", "devolutivas"];
const tipoDoValor = (valor: string): TipoDeRegraDePasta => TIPOS.find((tipo) => tipo === valor) ?? "comum";

export function SeletorDeTipo({ id, valor, aoMudar, desabilitado }: {
  id: string; valor: TipoDeRegraDePasta; aoMudar: (tipo: TipoDeRegraDePasta) => void; desabilitado?: boolean;
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={`${id}-tipo`}>Tipo de regra</FieldLabel>
      <Select id={`${id}-tipo`} value={valor} disabled={desabilitado} onChange={(evento) => aoMudar(tipoDoValor(evento.target.value))}>
        {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{ROTULO_DO_TIPO[tipo]}</option>)}
      </Select>
      {valor === "equipamentos" && (
        <p className="text-sm text-muted-foreground">
          A pasta tem uma subpasta por equipamento. O PDF solto cujo nome começa com SIMO vira o SIMO do equipamento; os PDFs da subpasta LAUDO viram os Laudos. O resto é recusado.
        </p>
      )}
      {valor === "protocolos" && (
        <p className="text-sm text-muted-foreground">
          Use a pasta PROJETOS do produto. Só entram PDFs dentro de uma subpasta com PROTOCOLO no nome (cada envio à Copasa é uma pasta nova); o resto é recusado. Cada protocolo novo leva o projeto para “Em análise”. Os arquivos chegam ocultos.
        </p>
      )}
      {valor === "devolutivas" && (
        <p className="text-sm text-muted-foreground">
          Use a pasta LAN do produto. Só entram PDFs soltos nela, sem subpasta (o APROVADO tem regra própria). Cada devolutiva nova leva o projeto de volta para “Em confecção”. Os arquivos chegam ocultos.
        </p>
      )}
    </Field>
  );
}

// Só a regra comum de um projeto pode marcar a etapa Aprovado; o banco também confere.
export function MarcaAprovado({ marcada, aoMudar, desabilitada }: { marcada: boolean; aoMudar: (marcada: boolean) => void; desabilitada?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <Caixa marcada={marcada} aoMudar={aoMudar} desabilitada={desabilitada}>Esta pasta marca a etapa Aprovado</Caixa>
      <p className="pl-7 text-sm text-muted-foreground">Cada PDF novo nela sugere (ou, no modo automático, aplica) a etapa Aprovado do projeto. O projeto precisa ter essa etapa marcada na tela Modelos.</p>
    </div>
  );
}

// Projeto (com categoria opcional) ou grupo do empreendimento. A categoria só existe quando há projeto escolhido.
// Na regra de equipamentos só se escolhe o projeto (que precisa ter as categorias SIMOS e Laudos).
// Protocolos e devolutivas escolhem o projeto (com categoria opcional), sem grupos: `semGrupos`.
export function EditorDeDestino({ id, valor, aoMudar, projetos, desabilitado, somenteProjeto = false, semGrupos = false }: {
  id: string; valor: Destino; aoMudar: (destino: Destino) => void; projetos: readonly ProjetoDaPasta[]; desabilitado?: boolean; somenteProjeto?: boolean; semGrupos?: boolean;
}) {
  const projeto = projetos.find((candidato) => candidato.id === valor.projetoId);
  if (somenteProjeto) {
    return (
      <Field className="min-w-0">
        <FieldLabel htmlFor={`${id}-projeto`}>Projeto (com as categorias SIMOS e Laudos)</FieldLabel>
        <Select id={`${id}-projeto`} value={valor.projetoId ?? ""} disabled={desabilitado}
          onChange={(evento) => aoMudar({ projetoId: evento.target.value || null, categoriaId: null, grupo: null, rotulo: null })}>
          <option value="">Escolha o projeto</option>
          {projetos.map((candidato) => <option key={candidato.id} value={candidato.id}>{candidato.nome}</option>)}
        </Select>
      </Field>
    );
  }
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Field className="min-w-0">
        <FieldLabel htmlFor={`${id}-destino`}>{semGrupos ? "Projeto" : "Destino"}</FieldLabel>
        <Select id={`${id}-destino`} value={valorDoDestino(valor)} disabled={desabilitado} onChange={(evento) => aoMudar(destinoDoValor(evento.target.value, valor.rotulo))}>
          <option value="">{semGrupos ? "Escolha o projeto" : "Escolha o destino"}</option>
          <optgroup label="Projetos">
            {projetos.map((candidato) => <option key={candidato.id} value={`p:${candidato.id}`}>{candidato.nome}</option>)}
          </optgroup>
          {!semGrupos && (
            <optgroup label="Grupos do empreendimento">
              {GRUPOS_DE_DOCUMENTO.map((grupo) => <option key={grupo} value={`g:${grupo}`}>{ROTULO_DO_GRUPO[grupo]}</option>)}
            </optgroup>
          )}
        </Select>
      </Field>
      {valor.grupo === "arquivo" && (
        <Field className="min-w-0">
          <FieldLabel htmlFor={`${id}-rotulo`}>Rótulo (nome do cartão em “Outros projetos”)</FieldLabel>
          <Input id={`${id}-rotulo`} value={valor.rotulo ?? ""} maxLength={TAMANHO_MAXIMO_DO_ROTULO} autoComplete="off" placeholder="Projeto Urbanístico"
            disabled={desabilitado} onChange={(evento) => aoMudar({ ...valor, rotulo: evento.target.value })} />
          <p className="text-sm text-muted-foreground">Os PDFs ficam guardados, ocultos, e a equipe libera quando o cliente precisar.</p>
        </Field>
      )}
      {projeto && (
        <Field className="min-w-0">
          <FieldLabel htmlFor={`${id}-categoria`}>Categoria (opcional)</FieldLabel>
          <Select id={`${id}-categoria`} value={valor.categoriaId ?? ""} disabled={desabilitado} onChange={(evento) => aoMudar({ ...valor, categoriaId: evento.target.value || null })}>
            <option value="">Sem categoria</option>
            {projeto.categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
          </Select>
        </Field>
      )}
    </div>
  );
}
