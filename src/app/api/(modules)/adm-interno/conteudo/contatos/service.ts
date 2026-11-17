import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, exigirRegistro } from "@/components/admin/conteudo/servidor";
import { consultaSchema, type AtualizarInput } from "./schema";
export async function listar(consulta: z.infer<typeof consultaSchema>) {
    const db = await createClient();
    let query = db.from("contatos").select("id,nome,telefone,email,mensagem,origem,lido,criado_em", { count: "exact" }).order("criado_em", { ascending: false });
    if (consulta.lido !== "todos")
        query = query.eq("lido", consulta.lido === "lidos");
    const { data, error, count } = await query.range((consulta.pagina - 1) * 50, consulta.pagina * 50 - 1);
    conferirErro(error);
    return { registros: data ?? [], total: count ?? 0 };
}
export async function atualizar({ id, ...valores }: AtualizarInput) {
    const db = await createClient();
    const { data, error } = await db.from("contatos").update(valores).eq("id", id).select("id,lido").maybeSingle();
    conferirErro(error);
    const registro = exigirRegistro(data);
    return { registro };
}
