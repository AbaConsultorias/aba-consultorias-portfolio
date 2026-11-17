import z from "zod";
export const texto = (max = 300) => z.string("Informe um texto.").trim().min(1, "Preencha este campo.").max(max, "Texto muito longo.");
export const opcional = (max = 300) => z.string().trim().max(max, "Texto muito longo.").nullable().transform(v => v || null);
export const https = z.string().trim().max(2000).url("Informe uma URL válida.").refine(v => v.startsWith("https://"), "Use uma URL https.").nullable().or(z.literal("")).transform(v => v || null);
export const uuid = z.uuid("ID inválido.");
export const identificadorSchema = z.object({ id: uuid });
export const ordem = z.number().int().min(0).max(1000000);
export const publicacao = { ordem, publicado: z.boolean() };
export const slug = texto(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens.");
export function caminho(prefixo: string, video = false) {
    return texto(300).regex(new RegExp("^" + prefixo + "/[0-9a-f-]{36}\\." + (video ? "mp4" : "(?:jpg|jpeg|png|webp)") + "$", "i"), "Envie um arquivo válido.")
        .refine(v => uuid.safeParse(v.split("/")[1]?.split(".")[0]).success, "Nome do arquivo inválido.");
}
export const caminhoProjeto = texto(400).regex(/^portfolio\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4)$/i, "Envie um arquivo do projeto.")
    .refine(v => uuid.safeParse(v.split("/")[1]).success && uuid.safeParse(v.split("/")[2]?.split(".")[0]).success, "Caminho do arquivo inválido.");
