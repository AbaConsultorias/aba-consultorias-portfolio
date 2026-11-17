"use client";
import { useMemo, useState } from "react";
import { Building2, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartaoEmpreendimento, type ItemEmpreendimento } from "./CartaoEmpreendimento";
import type { SituacaoEmpreendimento } from "./Selos";

type Filtro = "todos" | SituacaoEmpreendimento;
const FILTROS: { valor: Filtro; nome: string }[] = [
  { valor: "todos", nome: "Todos" },
  { valor: "ativo", nome: "Ativos" },
  { valor: "concluido", nome: "Concluídos" },
  { valor: "arquivado", nome: "Arquivados" },
];

const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function ListaEmpreendimentos({ itens, adminPath, podeEditar, parcial }: { itens: ItemEmpreendimento[]; adminPath: string; podeEditar: boolean; parcial: boolean }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    return itens.filter((item) => (filtro === "todos" || item.situacao === filtro) && (termo === "" || semAcento(item.nome).includes(termo)));
  }, [itens, busca, filtro]);
  const filtrando = busca.trim() !== "" || filtro !== "todos";

  return (
    <section aria-labelledby="lista-empreendimentos" className="mt-8 min-w-0 space-y-5">
      <h2 id="lista-empreendimentos" className="sr-only">Lista de empreendimentos</h2>
      {itens.length > 0 && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 lg:w-96">
            <label htmlFor="busca-empreendimentos" className="sr-only">Buscar empreendimento pelo nome</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input id="busca-empreendimentos" type="search" value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Buscar pelo nome" autoComplete="off"
              className="min-h-11 w-full rounded-lg border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          </div>
          <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
            {FILTROS.map(({ valor, nome }) => (
              <Button key={valor} type="button" variant={filtro === valor ? "default" : "outline"} aria-pressed={filtro === valor} className="portal-botao" onClick={() => setFiltro(valor)}>{nome}</Button>
            ))}
          </div>
        </div>
      )}
      {itens.length > 0 && (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {filtrando ? `${visiveis.length} de ${itens.length}` : itens.length} {itens.length === 1 ? "empreendimento" : "empreendimentos"}
          {parcial && " nesta página. A busca e o filtro valem só para ela; use Próxima para ver os demais."}
        </p>
      )}
      {itens.length === 0 ? (
        <div className="portal-vazio flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Building2 className="size-7" aria-hidden="true" /></span>
          <h3 className="text-lg font-medium">Nenhum empreendimento cadastrado</h3>
          <p>{podeEditar ? "Use “Novo empreendimento” para cadastrar o primeiro." : "Quando houver empreendimentos, eles aparecem aqui."}</p>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="portal-vazio flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><SearchX className="size-7" aria-hidden="true" /></span>
          <h3 className="text-lg font-medium">Nada encontrado</h3>
          <p>Nenhum empreendimento combina com a busca e a situação escolhidas.</p>
          <Button type="button" variant="outline" className="portal-botao" onClick={() => { setBusca(""); setFiltro("todos"); }}>Limpar busca e filtro</Button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((item) => <CartaoEmpreendimento key={item.id} item={item} adminPath={adminPath} podeEditar={podeEditar} />)}
        </ul>
      )}
    </section>
  );
}
