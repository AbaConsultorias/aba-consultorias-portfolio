import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BadRequestError, InternalServerError } from "@/app/api/HttpErrors";
import { conferirErro } from "@/lib/portal/obras/erros";

export type DependenciasRelato = {
  sessao: typeof createClient;
  assinar: (path: string) => Promise<{ path: string; signedUrl: string; token: string }>;
  lerObjeto: (path: string) => Promise<{ mime: string; stream: ReadableStream<Uint8Array> }>;
  apagar: (paths: string[]) => Promise<void>;
};
const AUSENTE = "Uma foto não chegou ao armazenamento. Envie novamente.";
export const dependenciasPadrao: DependenciasRelato = {
  sessao: createClient,
  async assinar(path) {
    const { data, error } = await createAdminClient().storage.from("obras").createSignedUploadUrl(path, { upsert: false });
    conferirErro(error);
    if (!data) throw new InternalServerError(null);
    return data;
  },
  async lerObjeto(path) {
    const { data, error } = await createAdminClient().storage.from("obras").createSignedUrl(path, 60);
    const erro = z.object({ status: z.number().optional(), statusCode: z.union([z.string(), z.number()]).optional() }).safeParse(error);
    if (erro.success && (erro.data.status === 404 || String(erro.data.statusCode) === "404")) throw new BadRequestError(AUSENTE);
    conferirErro(error);
    if (!data) throw new InternalServerError(null);
    const resposta = await fetch(data.signedUrl, { cache: "no-store", redirect: "error" });
    if (resposta.status === 404) throw new BadRequestError(AUSENTE);
    if (!resposta.ok || !resposta.body) throw new InternalServerError("Não foi possível conferir as fotos. Tente enviar novamente.");
    return { mime: (resposta.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), stream: resposta.body };
  },
  async apagar(paths) {
    if (!paths.length) return;
    const { error } = await createAdminClient().storage.from("obras").remove(paths);
    conferirErro(error);
  },
};
