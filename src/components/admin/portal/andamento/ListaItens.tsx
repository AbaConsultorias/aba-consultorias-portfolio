"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { reordenarItens } from "@/lib/portal/andamento/regras";
import { MARCOS_DE_ETAPA, ROTULO_DO_MARCO, type MarcoDeEtapa } from "@/app/api/(modules)/adm-interno/portal/modelos/schema";
type Item = { id?: string; nome: string; ordem: number; concluidaEm?: string | null; marco?: MarcoDeEtapa | null };
const marcoDoValor = (valor: string): MarcoDeEtapa | null => MARCOS_DE_ETAPA.find((marco) => marco === valor) ?? null;
// `marcas`: etapas de modelo, cada uma com a marca que a liga às etapas pelas pastas (no máximo uma de cada marca por modelo).
export function ListaItens({ value, onChange, concluir = false, marcas = false, rotulo }: { value: Item[]; onChange: (itens: Item[]) => void; concluir?: boolean; marcas?: boolean; rotulo: string }) {
  const itens = [...value].sort((a, b) => a.ordem - b.ordem);
  function mover(indice: number, delta: number) {
    onChange(reordenarItens(itens, indice, delta));
  }
  // Escolher uma marca já usada por outra etapa tira a marca da outra: o banco recusa marca repetida.
  function marcar(indice: number, marco: MarcoDeEtapa | null) {
    onChange(itens.map((v, i) => (i === indice ? { ...v, marco } : marco !== null && v.marco === marco ? { ...v, marco: null } : v)));
  }
  return <div className="space-y-3">{itens.map((item, indice) => <div key={item.id ?? indice} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
    <label className="min-w-40 flex-1 text-xs">Nome<Input aria-label={`${rotulo} ${indice + 1}`} value={item.nome} onChange={(e) => onChange(itens.map((v, i) => i === indice ? { ...v, nome: e.target.value } : v))} /></label>
    {concluir && <label className="text-xs">Concluída em<Input type="date" value={item.concluidaEm ?? ""} onChange={(e) => onChange(itens.map((v, i) => i === indice ? { ...v, concluidaEm: e.target.value || null } : v))} /></label>}
    {marcas && <label className="text-xs">Marca
      <select aria-label={`Marca da ${rotulo.toLowerCase()} ${indice + 1}`} value={item.marco ?? ""} onChange={(e) => marcar(indice, marcoDoValor(e.target.value))} className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3 text-sm">
        <option value="">Nenhuma</option>
        {MARCOS_DE_ETAPA.map((marco) => <option key={marco} value={marco}>{ROTULO_DO_MARCO[marco]}</option>)}
      </select>
    </label>}
    <Button type="button" size="icon" variant="outline" aria-label={`Subir ${item.nome}`} disabled={indice === 0} onClick={() => mover(indice, -1)}><ArrowUp size={16} /></Button>
    <Button type="button" size="icon" variant="outline" aria-label={`Descer ${item.nome}`} disabled={indice === itens.length - 1} onClick={() => mover(indice, 1)}><ArrowDown size={16} /></Button>
    <Button type="button" size="icon" variant="outline" aria-label={`Remover ${item.nome}`} onClick={() => onChange(itens.filter((_, i) => i !== indice).map((v, ordem) => ({ ...v, ordem })))}><Trash2 size={16} /></Button>
  </div>)}<Button type="button" variant="outline" disabled={itens.length >= 100} onClick={() => onChange([...itens, { nome: "", ordem: itens.length, ...(concluir ? { concluidaEm: null } : {}), ...(marcas ? { marco: null } : {}) }])}><Plus size={16} />Adicionar {rotulo.toLowerCase()}</Button>
    {concluir && <p className="text-xs text-muted-foreground">Limpe a data para reabrir. Concluir não altera a etapa atual.</p>}
    {marcas && <p className="text-xs text-muted-foreground">A marca liga a etapa aos arquivos das pastas do servidor: protocolo leva a “Em análise”, devolutiva a “Em confecção” e a pasta aprovada a “Aprovado”. Cada marca vale para uma só etapa do modelo; projetos já criados não mudam.</p>}
  </div>;
}
