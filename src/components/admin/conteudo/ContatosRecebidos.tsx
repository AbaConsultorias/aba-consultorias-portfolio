"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requisitar } from "./requisicao";
export type Contato = {
    id: string;
    nome: string;
    email: string | null;
    telefone: string | null;
    mensagem: string;
    origem: string | null;
    lido: boolean;
    criado_em: string;
};
export function ContatosRecebidos({ adminPath, registros, filtro, pagina, total, somenteLeitura = false }: {
    adminPath: string;
    registros: Contato[];
    filtro: string;
    pagina: number;
    total: number;
    somenteLeitura?: boolean;
}) {
    const router = useRouter();
    const [ocupado, setOcupado] = useState(false);
    const [erro, setErro] = useState("");
    const base = `/${adminPath}/conteudo/contatos`;
    async function marcar(registro: Contato) {
        setOcupado(true);
        setErro("");
        try {
            await requisitar(adminPath, "contatos", "PATCH", { id: registro.id, lido: !registro.lido });
            router.refresh();
        }
        catch {
            setErro("Não foi possível atualizar a mensagem.");
        }
        finally {
            setOcupado(false);
        }
    }
    return <section className="min-w-0 space-y-5"><h1 className="text-2xl font-semibold">Contatos recebidos</h1><nav aria-label="Filtrar contatos" className="flex flex-wrap gap-2">{[["todos", "Todos"], ["nao-lidos", "Não lidos"], ["lidos", "Lidos"]].map(([v, label]) => <Link key={v} aria-current={filtro === v ? "page" : undefined} className="rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-muted" href={`${base}?lido=${v}`}>{label}</Link>)}</nav>
 {erro && <p role="alert" className="text-destructive">{erro}</p>}{!registros.length && <p>Nenhum contato neste filtro.</p>}
 <ul className="space-y-3">{registros.map(r => <li key={r.id} className="min-w-0 rounded-xl border p-4"><details><summary className="cursor-pointer break-words rounded transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span className="font-semibold">{r.nome}</span> · {r.lido ? "Lido" : "Não lido"}<span className="block text-sm text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo"
    }).format(new Date(r.criado_em))}</span></summary><div className="mt-4 space-y-3"><p className="whitespace-pre-wrap break-words">{r.mensagem}</p>{r.origem && <p className="break-words text-sm text-muted-foreground">Origem: {r.origem}</p>}<div className="flex flex-wrap gap-3">{r.telefone && <a className="break-all text-sm underline focus-visible:outline-2 focus-visible:outline-ring" href={`https://wa.me/${r.telefone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">WhatsApp: {r.telefone}<span className="sr-only"> (abre em nova aba)</span></a>}{r.email && <a className="break-all text-sm underline focus-visible:outline-2 focus-visible:outline-ring" href={`mailto:${encodeURIComponent(r.email)}`}>E-mail: {r.email}</a>}</div></div></details>{!somenteLeitura && <Button className="mt-3" variant="outline" disabled={ocupado} onClick={() => void marcar(r)}>Marcar como {r.lido ? "não lido" : "lido"}</Button>}</li>)}</ul>
 <nav aria-label="Páginas de contatos" className="flex flex-wrap items-center gap-4">{pagina > 1 && <Link className="underline focus-visible:outline-2 focus-visible:outline-ring" href={`${base}?lido=${filtro}&pagina=${pagina - 1}`}>Anterior</Link>}<span className="text-sm">Página {pagina} · {total} contatos</span>{pagina * 50 < total && <Link className="underline focus-visible:outline-2 focus-visible:outline-ring" href={`${base}?lido=${filtro}&pagina=${pagina + 1}`}>Próxima</Link>}</nav>
 </section>;
}
