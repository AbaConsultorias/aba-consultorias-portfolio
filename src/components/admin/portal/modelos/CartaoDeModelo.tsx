"use client";
import { ChevronRight, FolderOpen, ListOrdered, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Selo, plural } from "@/components/admin/portal/empreendimentos/Selos";
import { MARCOS_DE_ETAPA, ROTULO_DO_MARCO, type MarcoDeEtapa } from "@/app/api/(modules)/adm-interno/portal/modelos/schema";
import { TOM_DO_MARCO, porOrdem, type Modelo } from "./tipos";

// Etapa com marca ganha a cor do selo correspondente (mesmos tokens do portal, claros e escuros).
function corDoMarco(marco: MarcoDeEtapa): React.CSSProperties {
  const tom = TOM_DO_MARCO[marco];
  return { borderColor: `var(--portal-${tom}-marca)`, background: `var(--portal-${tom}-bg)`, color: `var(--portal-${tom}-fg)` };
}

export function LegendaDosMarcos() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>Marcas das etapas pelas pastas:</span>
      {MARCOS_DE_ETAPA.map((marco) => <Selo key={marco} tom={TOM_DO_MARCO[marco]}>{ROTULO_DO_MARCO[marco]}</Selo>)}
    </p>
  );
}

export function ResumoDoModelo({ modelo, podeEditar, aoEditar, aoExcluir }: {
  modelo: Modelo; podeEditar: boolean; aoEditar: () => void; aoExcluir: () => void;
}) {
  const etapas = porOrdem(modelo.etapas);
  const categorias = porOrdem(modelo.categorias);
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-lg font-medium leading-snug [overflow-wrap:anywhere]">{modelo.nome}</h3>
            <Selo tom={modelo.ativo ? "ok" : "neutro"}>{modelo.ativo ? "Ativo" : "Inativo"}</Selo>
          </div>
          {modelo.descricao && <p className="max-w-prose text-sm text-muted-foreground [overflow-wrap:anywhere]">{modelo.descricao}</p>}
        </div>
        {podeEditar && (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={`Editar ${modelo.nome}`} title="Editar" onClick={aoEditar}><Pencil aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" className="size-11 text-muted-foreground hover:text-destructive" aria-label={`Excluir ${modelo.nome}`} title="Excluir" onClick={aoExcluir}><Trash2 aria-hidden="true" /></Button>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ListOrdered className="size-4" aria-hidden="true" />{plural(etapas.length, "etapa", "etapas")}
        </p>
        {etapas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma etapa cadastrada.</p> : (
          <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2" aria-label={`Etapas de ${modelo.nome}`}>
            {etapas.map((etapa, indice) => (
              <li key={etapa.id ?? indice} className="flex min-w-0 items-center gap-1">
                <span className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-sm" style={etapa.marco ? corDoMarco(etapa.marco) : undefined}
                  title={etapa.marco ? `Marca: ${ROTULO_DO_MARCO[etapa.marco]}` : undefined}>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background/70 text-[0.6875rem] font-semibold" aria-hidden="true">{indice + 1}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{etapa.nome}</span>
                  {etapa.marco && <span className="sr-only">(marca {ROTULO_DO_MARCO[etapa.marco]})</span>}
                </span>
                {indice < etapas.length - 1 && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="min-w-0 space-y-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <FolderOpen className="size-4" aria-hidden="true" />{plural(categorias.length, "categoria de documento", "categorias de documento")}
        </p>
        {categorias.length > 0 && (
          <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={`Categorias de documento de ${modelo.nome}`}>
            {categorias.map((categoria, indice) => (
              <li key={categoria.id ?? indice} className="min-w-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{categoria.nome}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
