"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import z from "zod";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import { EditorRegistro } from "./EditorRegistro";
import { GaleriaProjeto } from "./GaleriaProjeto";
import { recursos, nomeRegistro, type Registro } from "./recursos";
import type { NomeRecurso } from "./schemas";
import { ErroSessaoExpirada, requisitar, removerArquivos } from "./requisicao";
export function ListaConteudo({ recurso, registros, adminPath, donoId, aoAtualizar, somenteLeitura = false }: {
    recurso: NomeRecurso;
    registros: Registro[];
    adminPath: string;
    donoId?: string;
    aoAtualizar?: () => void;
    somenteLeitura?: boolean;
}) {
    const router = useRouter();
    const definicao = recursos[recurso];
    const [editor, setEditor] = useState<Registro | "novo" | null>(null);
    const [ocupado, setOcupado] = useState(false);
    const [mensagem, setMensagem] = useState("");
    const [erro, setErro] = useState("");
    const [pendentes, setPendentes] = useState<string[]>([]);
    function atualizar() {
        aoAtualizar?.();
        router.refresh();
    }
    // Devolve a mensagem de erro (ou null). `avisarNoTopo` falso deixa o aviso com quem chamou.
    async function executar(acao: () => Promise<void>, avisarNoTopo = true): Promise<string | null> {
        setOcupado(true);
        setErro("");
        setMensagem("");
        let falha: string | null = null;
        let sessaoExpirou = false;
        try {
            await acao();
        }
        catch (e) {
            sessaoExpirou = e instanceof ErroSessaoExpirada;
            falha = e instanceof Error ? e.message : "Não foi possível concluir.";
            if (avisarNoTopo)
                setErro(falha);
        }
        finally {
            // Com a sessão expirada, recarregar levaria a outra tela e apagaria o aviso.
            if (!sessaoExpirou)
                atualizar();
            setOcupado(false);
        }
        return falha;
    }
    async function excluir(registro: Registro) {
        if (ocupado)
            return "Aguarde a operação em andamento terminar.";
        let excluido = false;
        const falha = await executar(async () => {
            const details = await requisitar(adminPath, recurso, "DELETE", { id: registro.id });
            excluido = true;
            const arquivos = z.array(z.string()).parse(details.arquivos);
            setPendentes(arquivos);
            atualizar();
            await removerArquivos(adminPath, arquivos);
            setPendentes([]);
            setMensagem("Registro e arquivos excluídos.");
        }, false);
        // Com o registro já fora da lista, a confirmação some: o aviso fica no topo.
        if (falha && excluido)
            setErro(falha);
        return excluido ? null : falha;
    }
    async function mover(indice: number, direcao: number) {
        const lista = [...registros];
        const destino = indice + direcao;
        [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
        await executar(async () => {
            for (const [ordem, registro] of lista.entries()) {
                try {
                    await requisitar(adminPath, recurso, "PATCH", { ...registro, ordem });
                }
                catch (e) {
                    if (e instanceof ErroSessaoExpirada)
                        throw e;
                    throw new Error(`${e instanceof Error ? e.message : "Não foi possível concluir."} A ordem pode ter sido salva só em parte: confira a lista e tente de novo.`);
                }
            }
            setMensagem("Ordem atualizada.");
        });
    }
    const editando = editor && editor !== "novo" ? editor : undefined;
    const Titulo = recurso === "midias-projeto" ? "h2" : "h1";
    return <div className="min-w-0 space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><Titulo className="text-2xl font-semibold">{definicao.titulo}</Titulo>{!somenteLeitura && !definicao.singleton && <Button disabled={ocupado || Boolean(editor)} onClick={() => setEditor("novo")}>Novo registro</Button>}</div>
  <p role="status" className="text-sm text-muted-foreground">{mensagem}</p>{erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
  {pendentes.length > 0 && <div className="rounded-lg border p-3"><p className="mb-2 text-sm">O registro foi excluído. Falta remover arquivos do armazenamento.</p><Button variant="outline" disabled={ocupado} onClick={() => void executar(async () => {
        await removerArquivos(adminPath, pendentes);
        setPendentes([]);
        setMensagem("Arquivos removidos.");
    })}>Tentar remover arquivos novamente</Button></div>}
  {editor && <EditorRegistro key={editando?.id ?? "novo"} recurso={recurso} registro={editando} adminPath={adminPath} donoId={donoId} proximaOrdem={Math.max(-1, ...registros.map(r => r.ordem ?? 0)) + 1} onCancelar={() => setEditor(null)} onSalvar={salvo => {
        setEditor(recurso === "projetos" ? salvo : null);
        setMensagem("Alterações salvas.");
        atualizar();
    }}/>}
  {recurso === "projetos" && editando && <GaleriaProjeto adminPath={adminPath} projetoId={editando.id}/>}
  {!registros.length && !editor && <p className="rounded-xl border p-6 text-muted-foreground">Nenhum registro encontrado.</p>}
  <ul className="space-y-3" aria-label={definicao.titulo}>
   {registros.map((registro, i) => <li key={registro.id} className="min-w-0 rounded-xl border bg-card p-4">
    <div className="mb-3 flex flex-wrap items-center gap-2"><p className="min-w-0 break-words font-semibold">{definicao.singleton ? "Dados do site" : nomeRegistro(registro)}</p>{typeof registro.publicado === "boolean" && <span className="rounded bg-muted px-2 py-1 text-xs">{registro.publicado ? "Publicado" : "Rascunho"}</span>}</div>
    {!somenteLeitura && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={ocupado || Boolean(editor)} onClick={() => setEditor(registro)}>Editar</Button>
     {!definicao.singleton && <>
      {typeof registro.publicado === "boolean" && <Button variant="outline" disabled={ocupado || Boolean(editor)} onClick={() => void executar(async () => {
                await requisitar(adminPath, recurso, "PATCH", { ...registro, publicado: !registro.publicado });
                setMensagem("Publicação atualizada.");
            })}>{registro.publicado ? "Despublicar" : "Publicar"}</Button>}
      <Button variant="outline" disabled={ocupado || Boolean(editor) || i === 0} aria-label={`Subir ${nomeRegistro(registro)}`} onClick={() => void mover(i, -1)}><ArrowUp className="size-4"/>Subir</Button>
      <Button variant="outline" disabled={ocupado || Boolean(editor) || i === registros.length - 1} aria-label={`Descer ${nomeRegistro(registro)}`} onClick={() => void mover(i, 1)}><ArrowDown className="size-4"/>Descer</Button>
      {editor || pendentes.length > 0
            ? <Button variant="destructive" disabled>Excluir</Button>
            : <ConfirmarExclusao tamanho="default" aviso={`Excluir "${nomeRegistro(registro)}" e seus arquivos? Esta ação não pode ser desfeita.`} aoConfirmar={() => excluir(registro)}/>}
     </>}
    </div>}
   </li>)}
  </ul>
 </div>;
}
