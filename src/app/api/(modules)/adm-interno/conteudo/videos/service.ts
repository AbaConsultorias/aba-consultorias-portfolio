import "server-only";
import z from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, exigirRegistro } from "@/components/admin/conteudo/servidor";
import { exigirArquivoConferido } from "../upload/service";
import { consultaSchema, type AtualizarInput, type CriarInput } from "./schema";
export async function listar(_consulta: z.infer<typeof consultaSchema>) {
    void _consulta;
    const db = await createClient();
    const { data, error } = await db.from("videos_instagram").select("*").order("ordem").order("id");
    conferirErro(error);
    return { registros: data ?? [] };
}
export async function atualizar({ id, ...valores }: AtualizarInput) {
    const db = await createClient();
    const anterior = await db.from("videos_instagram").select("video_path,poster_path").eq("id", id).maybeSingle();
    conferirErro(anterior.error);
    const atual = exigirRegistro(anterior.data);
    await exigirArquivoConferido(valores.video_path, "video", atual.video_path);
    await exigirArquivoConferido(valores.poster_path, "imagem", atual.poster_path);
    const { data, error } = await db.from("videos_instagram").update(valores).eq("id", id).select("*").maybeSingle();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
export async function criar(valores: CriarInput) {
    const db = await createClient();
    await exigirArquivoConferido(valores.video_path, "video");
    await exigirArquivoConferido(valores.poster_path, "imagem");
    const { data, error } = await db.from("videos_instagram").insert(valores).select("*").single();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
export async function excluir(id: string) {
    const db = await createClient();
    const anterior = await db.from("videos_instagram").select("video_path,poster_path").eq("id", id).maybeSingle();
    conferirErro(anterior.error);
    const registro = exigirRegistro(anterior.data);
    const arquivos: string[] = ["video_path", "poster_path"].flatMap(campo => {
        const valor = (registro as unknown as Record<string, unknown>)[campo];
        return typeof valor === "string" ? [valor] : [];
    });
    const { data, error } = await db.from("videos_instagram").delete().eq("id", id).select("id").maybeSingle();
    conferirErro(error);
    exigirRegistro(data);
    revalidatePath("/", "layout");
    return { arquivos: [...new Set(arquivos)] };
}
