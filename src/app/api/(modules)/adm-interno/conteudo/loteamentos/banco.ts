import { revalidatePath } from "next/cache";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  TooManyRequestsError,
} from "@/app/api/HttpErrors";
import { limitar } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "site-publico";

export async function limitarEscrita(usuarioId: string) {
  if (!(await limitar(`conteudo-escrita:${usuarioId}`, 300, 10 * 60))) {
    throw new TooManyRequestsError("Muitas alterações seguidas. Tente novamente em alguns minutos.");
  }
}

export function atualizarSite() {
  revalidatePath("/", "layout");
}

type ErroDoBanco = { code?: string; message?: string };

// Traduz o erro do Postgres/PostgREST sem expor mensagem nem nome de tabela.
export function erroDoBanco(error: ErroDoBanco, contexto: string, mensagemDuplicado: string): never {
  if (error.code === "23505") throw new ConflictError(mensagemDuplicado);
  if (error.code === "23514" || error.code === "22P02" || error.code === "23503") {
    throw new BadRequestError("Dados inválidos.");
  }
  if (error.code === "42501") throw new ForbiddenError("Acesso negado.");

  console.error(`[${contexto}] falha no banco:`, error.code);
  throw new InternalServerError(null);
}

// Limpeza de arquivos é de melhor esforço: o registro já foi gravado e um
// arquivo órfão não quebra o site; só registramos o código do erro.
// Client admin, como na rota de upload: só é chamado depois que o client da
// sessão (RLS de staff) já gravou ou apagou o registro dono desses caminhos.
export async function removerArquivos(paths: (string | null | undefined)[]) {
  const lista = paths.filter((path): path is string => Boolean(path));
  if (lista.length === 0) return;

  const { error } = await createAdminClient().storage.from(BUCKET).remove(lista);
  if (error) console.error("[conteudo] falha ao apagar arquivos:", error.message);
}

export async function removerPasta(pasta: string) {
  const { data, error } = await createAdminClient().storage.from(BUCKET).list(pasta, { limit: 1000 });
  if (error) {
    console.error("[conteudo] falha ao listar arquivos:", error.message);
    return;
  }
  await removerArquivos((data ?? []).map((arquivo) => `${pasta}/${arquivo.name}`));
}
