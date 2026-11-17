import { SeloSituacao, type SituacaoEmpreendimento } from "./Selos";

export function DadosDoEmpreendimento({ situacao, cidade, descricao, loteamento }: { situacao: SituacaoEmpreendimento; cidade: string | null; descricao: string | null; loteamento: string | null }) {
  const vazio = <span className="text-muted-foreground">Não informado</span>;
  return (
    <section aria-labelledby="titulo-dados" className="min-w-0 space-y-4">
      <h2 id="titulo-dados" className="text-xl font-medium">Dados do empreendimento</h2>
      <dl className="grid gap-x-8 gap-y-5 rounded-2xl border bg-card p-5 sm:grid-cols-2">
        <div><dt className="text-sm text-muted-foreground">Situação</dt><dd className="mt-1"><SeloSituacao situacao={situacao} /></dd></div>
        <div><dt className="text-sm text-muted-foreground">Cidade</dt><dd className="mt-1 [overflow-wrap:anywhere]">{cidade || vazio}</dd></div>
        {loteamento && <div><dt className="text-sm text-muted-foreground">Loteamento</dt><dd className="mt-1 [overflow-wrap:anywhere]">{loteamento}</dd></div>}
        <div className="sm:col-span-2"><dt className="text-sm text-muted-foreground">Descrição</dt><dd className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{descricao || vazio}</dd></div>
      </dl>
    </section>
  );
}
