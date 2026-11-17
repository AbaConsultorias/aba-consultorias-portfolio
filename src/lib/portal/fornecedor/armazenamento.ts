import "server-only";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createAdminClient } from "@/lib/supabase/admin";

export type ObjetoArmazenado = { contentType: string | null; stream: ReadableStream<Uint8Array> };
// Fornecedores seguem no Supabase Storage; os documentos de cliente foram para o R2 (Etapa 7).
export type Armazenamento = {
  criarUrlAssinada: (path: string) => Promise<{ signedUrl: string; token: string }>;
  // null = objeto ausente; falha transitória lança.
  abrirObjeto: (path: string) => Promise<ObjetoArmazenado | null>;
  // Idempotente: apagar objeto ausente não é erro.
  removerObjeto: (path: string) => Promise<void>;
};

const erroSchema = z.object({ statusCode: z.union([z.string(), z.number()]).optional(), status: z.number().optional() });
function ausente(error: unknown) {
  const e = erroSchema.safeParse(error);
  return e.success && (String(e.data.statusCode) === "404" || e.data.status === 404);
}
function falhar(error: unknown): never {
  const e = erroSchema.safeParse(error);
  console.error("[fornecedor] storage:", e.success ? e.data.statusCode : undefined, e.success ? e.data.status : undefined);
  throw new InternalServerError(null);
}
export const armazenamentoFornecedor: Armazenamento = {
  async criarUrlAssinada(path) {
    const { data, error } = await createAdminClient().storage.from("fornecedores").createSignedUploadUrl(path, { upsert: false });
    if (error || !data) falhar(error);
    return { signedUrl: data.signedUrl, token: data.token };
  },
  async abrirObjeto(path) {
    const storage = createAdminClient().storage.from("fornecedores");
    const info = await storage.info(path);
    if (info.error) { if (ausente(info.error)) return null; falhar(info.error); }
    const { data, error } = await storage.download(path).asStream();
    if (error) { if (ausente(error)) return null; falhar(error); }
    if (!data) return null;
    return { contentType: typeof info.data?.contentType === "string" ? info.data.contentType : null, stream: data as ReadableStream<Uint8Array> };
  },
  async removerObjeto(path) {
    const { error } = await createAdminClient().storage.from("fornecedores").remove([path]);
    if (error && !ausente(error)) falhar(error);
  },
};
