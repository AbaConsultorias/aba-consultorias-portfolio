"use client";
import { useCallback, useEffect, useState } from "react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { ListaConteudo } from "./ListaConteudo";
import { requisitar } from "./requisicao";
import type { Registro } from "./recursos";
export function GaleriaProjeto({ adminPath, projetoId }: {
    adminPath: string;
    projetoId: string;
}) {
    const [registros, setRegistros] = useState<Registro[]>([]);
    const [erro, setErro] = useState("");
    const [carregando, setCarregando] = useState(true);
    const carregar = useCallback(async () => {
        try {
            const details = await requisitar(adminPath, `midias-projeto?portfolio_projeto_id=${projetoId}`, "GET");
            setRegistros(z.array(z.object({ id: z.uuid() }).passthrough()).parse(details.registros) as Registro[]);
            setErro("");
        }
        catch {
            setErro("Não foi possível carregar a galeria.");
        }
        finally {
            setCarregando(false);
        }
    }, [adminPath, projetoId]);
    useEffect(() => {
        void Promise.resolve().then(carregar);
    }, [carregar]);
    return <section aria-label="Galeria do projeto" className="rounded-xl border p-4">{carregando ? <p role="status">Carregando galeria…</p> : erro ? <><p role="alert">{erro}</p><Button onClick={() => void carregar()}>Tentar novamente</Button></> : <ListaConteudo recurso="midias-projeto" registros={registros} adminPath={adminPath} donoId={projetoId} aoAtualizar={() => void carregar()}/>}</section>;
}
