import "server-only";
import z from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, exigirRegistro } from "@/components/admin/conteudo/servidor";
import { BadRequestError } from "@/app/api/HttpErrors";
import { exigirArquivoConferido } from "../upload/service";
import { consultaSchema, type AtualizarInput, type CriarInput } from "./schema";
export async function listar(_consulta: z.infer<typeof consultaSchema>) {
    void _consulta;
    const db = await createClient();
    const { data, error } = await db.from("portfolio_projetos").select("*").order("ordem").order("id");
    conferirErro(error);
    return { registros: data ?? [] };
}
export async function atualizar({ id, ...valores }: AtualizarInput) {
    const db = await createClient();
    if (valores.capa_path && !valores.capa_path.startsWith(`portfolio/${id}/`))
        throw new BadRequestError("Arquivo incompatível com o projeto.");
    const anterior = await db.from("portfolio_projetos").select("capa_path").eq("id", id).maybeSingle();
    conferirErro(anterior.error);
    await exigirArquivoConferido(valores.capa_path, "imagem", exigirRegistro(anterior.data).capa_path);
    const { data, error } =await db.from("portfolio_projetos").update(valores).eq("id", id).select("*").maybeSingle();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
export async function criar(valores: CriarInput) {
    const db = await createClient();
    if (valores.capa_path)
        throw new BadRequestError("Crie o projeto antes de enviar sua capa.");
    const { data, error } = await db.from("portfolio_projetos").insert(valores).select("*").single();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
export async function excluir(id: string) {
    const db = await createClient();
    const anterior = await db.from("portfolio_projetos").select("capa_path").eq("id", id).maybeSingle();
    conferirErro(anterior.error);
    const registro = exigirRegistro(anterior.data);
    const arquivos: string[] = ["capa_path"].flatMap(campo => {
        const valor = (registro as unknown as Record<string, unknown>)[campo];
        return typeof valor === "string" ? [valor] : [];
    });
    const galeria = await db.from("midias").select("storage_path").eq("portfolio_projeto_id", id);
    conferirErro(galeria.error);
    arquivos.push(...(galeria.data ?? []).map(m => String(m.storage_path)));
    const { data, error } = await db.from("portfolio_projetos").delete().eq("id", id).select("id").maybeSingle();
    conferirErro(error);
    exigirRegistro(data);
    revalidatePath("/", "layout");
    return { arquivos: [...new Set(arquivos)] };
}
