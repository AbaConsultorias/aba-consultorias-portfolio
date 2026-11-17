import "server-only";
import z from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, exigirRegistro } from "@/components/admin/conteudo/servidor";
import { consultaSchema, type AtualizarInput } from "./schema";
export async function listar(_consulta: z.infer<typeof consultaSchema>) {
    void _consulta;
    const db = await createClient();
    const { data, error } = await db.from("configuracoes_site").select("*");
    conferirErro(error);
    return { registros: data ?? [] };
}
export async function atualizar({ id, ...valores }: AtualizarInput) {
    const db = await createClient();
    const { data, error } = await db.from("configuracoes_site").update(valores).eq("id", id).select("*").maybeSingle();
    conferirErro(error);
    const registro = exigirRegistro(data);
    revalidatePath("/", "layout");
    return { registro };
}
