"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmarRemocao } from "@/components/admin/portal/empreendimentos/ConfirmarRemocao";
import { LegendaDosMarcos, ResumoDoModelo } from "./CartaoDeModelo";
import { EditorDeModelo } from "./EditorDeModelo";
import type { Modelo } from "./tipos";

type Filtro = "todos" | "ativos" | "inativos";
const FILTROS: { valor: Filtro; nome: string }[] = [
  { valor: "todos", nome: "Todos" },
  { valor: "ativos", nome: "Ativos" },
  { valor: "inativos", nome: "Inativos" },
];

export function GestaoDeModelos({ adminPath, modelos, podeEditar }: { adminPath: string; modelos: Modelo[]; podeEditar: boolean }) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const visiveis = useMemo(() => modelos.filter((modelo) => filtro === "todos" || (filtro === "ativos") === modelo.ativo), [modelos, filtro]);

  function concluir(mensagem: string) {
    setCriando(false);
    setEditando(null);
    setExcluindo(null);
    setAviso(mensagem);
    router.refresh();
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="portal-sobretitulo">Gestão do portal</p>
          <h1 className="portal-titulo">Modelos de etapas</h1>
          <p className="portal-descricao">Cada projeto novo copia as etapas e as categorias de um modelo. Editar um modelo não altera projetos já criados. Prefira desativar a excluir.</p>
        </div>
        {podeEditar && (
          <Button type="button" className="portal-botao" aria-expanded={criando} aria-controls="novo-modelo" onClick={() => { setAviso(""); setEditando(null); setCriando(!criando); }}>
            {criando ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}{criando ? "Fechar" : "Novo modelo"}
          </Button>
        )}
      </header>
      <p role="status" aria-live="polite" className="mt-3 text-sm">{aviso}</p>

      {podeEditar && criando && (
        <section id="novo-modelo" aria-labelledby="titulo-novo-modelo" className="mt-4 rounded-2xl border bg-card p-5">
          <h2 id="titulo-novo-modelo" className="mb-5 text-lg font-medium">Novo modelo</h2>
          <EditorDeModelo adminPath={adminPath} modelo={null} aoSalvar={concluir} aoCancelar={() => setCriando(false)} />
        </section>
      )}

      <section aria-labelledby="lista-modelos" className="mt-8 min-w-0 space-y-5">
        <h2 id="lista-modelos" className="sr-only">Lista de modelos</h2>
        {modelos.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-muted-foreground">{filtro === "todos" ? modelos.length : `${visiveis.length} de ${modelos.length}`} {modelos.length === 1 ? "modelo" : "modelos"}</p>
              <LegendaDosMarcos />
            </div>
            <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-2">
              {FILTROS.map(({ valor, nome }) => (
                <Button key={valor} type="button" variant={filtro === valor ? "default" : "outline"} aria-pressed={filtro === valor} className="portal-botao" onClick={() => setFiltro(valor)}>{nome}</Button>
              ))}
            </div>
          </div>
        )}
        {modelos.length === 0 ? (
          <div className="portal-vazio flex flex-col items-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><LayoutTemplate className="size-7" aria-hidden="true" /></span>
            <h3 className="text-lg font-medium">Nenhum modelo cadastrado</h3>
            <p>{podeEditar ? "Use “Novo modelo” para cadastrar o primeiro." : "Quando houver modelos, eles aparecem aqui."}</p>
          </div>
        ) : visiveis.length === 0 ? (
          <p className="portal-vazio text-center">Nenhum modelo nesta situação.</p>
        ) : (
          <ul className="space-y-4">
            {visiveis.map((modelo) => (
              <li key={modelo.id} className="min-w-0 rounded-2xl border bg-card p-5 transition-colors data-[editando=true]:border-primary/50" data-editando={editando === modelo.id}>
                {editando === modelo.id ? (
                  <>
                    <h3 className="mb-5 text-lg font-medium [overflow-wrap:anywhere]">Editar “{modelo.nome}”</h3>
                    <EditorDeModelo adminPath={adminPath} modelo={modelo} aoSalvar={concluir} aoCancelar={() => setEditando(null)} />
                  </>
                ) : (
                  <div className="space-y-4">
                    <ResumoDoModelo modelo={modelo} podeEditar={podeEditar}
                      aoEditar={() => { setAviso(""); setCriando(false); setExcluindo(null); setEditando(modelo.id); }}
                      aoExcluir={() => { setAviso(""); setExcluindo(modelo.id); }} />
                    {excluindo === modelo.id && (
                      <ConfirmarRemocao adminPath={adminPath} recurso="modelos" id={modelo.id}
                        aviso={`Excluir o modelo “${modelo.nome}”? Não é possível excluir um modelo que já gerou projetos; nesse caso, desative-o.`}
                        rotulo="Excluir modelo" aoConcluir={() => concluir(`Modelo “${modelo.nome}” excluído.`)} aoCancelar={() => setExcluindo(null)} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
