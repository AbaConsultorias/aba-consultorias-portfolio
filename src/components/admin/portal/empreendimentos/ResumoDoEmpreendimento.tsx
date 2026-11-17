import Link from "next/link";
import { FolderOpen, Layers, FileText, Users, type LucideIcon } from "lucide-react";
import type { AbaDoEmpreendimento } from "./Abas";

// Cada bloco só vem preenchido quando a pessoa pode ver aquela parte; null é contagem que falhou.
export type DadosDoResumo = {
  projetos: number | null;
  clientes?: number | null;
  documentos?: { liberados: number | null; ocultos: number | null };
  pasta?: { codigo: string | null; regrasAtivas: number | null };
};

const numero = (valor: number | null) => (valor === null ? "—" : String(valor));

function Bloco({ href, Icone, rotulo, principal, detalhe }: { href: string; Icone: LucideIcon; rotulo: string; principal: string; detalhe?: string }) {
  return (
    <li className="min-w-0">
      <Link href={href} prefetch={false} className="flex h-full min-h-11 flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50">
        <span className="flex items-center gap-2 text-sm text-muted-foreground"><Icone className="size-4 shrink-0" aria-hidden="true" />{rotulo}</span>
        <span className="text-2xl font-medium tracking-tight [overflow-wrap:anywhere]">{principal}</span>
        {detalhe && <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{detalhe}</span>}
      </Link>
    </li>
  );
}

export function ResumoDoEmpreendimento({ base, hrefDocumentos, dados }: { base: string; hrefDocumentos: string; dados: DadosDoResumo }) {
  const aba = (nome: AbaDoEmpreendimento) => `${base}?aba=${nome}`;
  const { documentos, pasta } = dados;
  return (
    <ul aria-label="Resumo do empreendimento" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Bloco href={aba("projetos")} Icone={Layers} rotulo="Projetos" principal={numero(dados.projetos)} />
      {dados.clientes !== undefined && <Bloco href={aba("clientes")} Icone={Users} rotulo="Clientes" principal={numero(dados.clientes)} detalhe="vinculados" />}
      {documentos && <Bloco href={hrefDocumentos} Icone={FileText} rotulo="Documentos" principal={numero(documentos.liberados)} detalhe={`liberados · ${numero(documentos.ocultos)} ocultos`} />}
      {pasta && <Bloco href={aba("pasta")} Icone={FolderOpen} rotulo="Pasta do servidor" principal={pasta.codigo ?? "Sem código"} detalhe={`${numero(pasta.regrasAtivas)} ${pasta.regrasAtivas === 1 ? "regra ativa" : "regras ativas"}`} />}
    </ul>
  );
}
