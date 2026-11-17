import "server-only";
import z from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, exigirRegistro } from "@/components/admin/conteudo/servidor";
import { BadRequestError } from "@/app/api/HttpErrors";
import { exigirArquivoConferido } from "../upload/service";
import { consultaSchema, type AtualizarInput, type CriarInput } from "./schema";
export async function listar(consulta: z.infer<typeof consultaSchema>) {
    const db = await createClient();
    const { data, error } = await db.from("midias").select("*").eq("portfolio_projeto_id", consulta.portfolio_projeto_id).order("ordem").order("id");
    conferirErro(error);
    return { registros: data ?? [] };
}
export async function atualizar({ id, ...valores }: AtualizarInput) {
    const db = await createClient();
    const dono = await db.from("portfolio_projetos").select("id").eq("id", valores.portfolio_projeto_id).maybeSingle();
    conferirErro(dono.error);
    exigirRegistro(dono.data);
    const anterior = await db.from("midias").select("portfolio_projeto_id,storage_path").eq("id", id).is("loteamento_id", null).maybeSingle();
    conferirErro(anterior.error);
    const atual = exigirRegistro(anterior.data);
    if (atual.portfolio_projeto_id !== valores.portfolio_projeto_id)
        throw new BadRequestError("Mídia incompatível com o projeto.");
    await exigirArquivoConferido(valores.storage_path, valores.tipo === "video" ? "video" : "imagem", atual.storage_path);
    const { data, error } = await db.from("midias").update(valores).eq("id", id).is("loteamento_id", null).select("*").maybeSingle();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
export async function criar(valores: CriarInput) {
    const db = await createClient();
    const dono = await db.from("portfolio_projetos").select("id").eq("id", valores.portfolio_projeto_id).maybeSingle();
    conferirErro(dono.error);
    exigirRegistro(dono.data);
    await exigirArquivoConferido(valores.storage_path, valores.tipo === "video" ? "video" : "imagem");
    const { data, error } = await db.from("midias").insert(valores).select("*").single();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
export async function excluir(id: string) {
    const db = await createClient();
    const anterior = await db.from("midias").select("storage_path").eq("id", id).is("loteamento_id", null).maybeSingle();
    conferirErro(anterior.error);
    const registro = exigirRegistro(anterior.data);
    const arquivos: string[] = ["storage_path"].flatMap(campo => {
        const valor = (registro as unknown as Record<string, unknown>)[campo];
        return typeof valor === "string" ? [valor] : [];
    });
    const { data, error } = await db.from("midias").delete().eq("id", id).is("loteamento_id", null).select("id").maybeSingle();
    conferirErro(error);
    exigirRegistro(data);
    revalidatePath("/", "layout");
    return { arquivos: [...new Set(arquivos)] };
}
