import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ForbiddenError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { exigirPapel, exigirPapelApi } from "./guard";
import { ehStaff, PAPEIS_STAFF, PAPEIS_USUARIO } from "./papeis";
import { ehPermissao, type Permissao } from "./permissoes";
import { regraPermite, type RegraAcesso, type RegraInterna } from "./regras";

const TODOS_OS_PAPEIS = [...PAPEIS_USUARIO, ...PAPEIS_STAFF];

// Erro na consulta vale como sem permissão: conjunto vazio nega tudo, menos o que é só do papel.
export const obterMinhasPermissoes = cache(async (): Promise<ReadonlySet<Permissao>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("minhas_permissoes");
  if (error) {
    console.error("[permissoes] leitura:", error.code);
    return new Set();
  }
  return new Set((Array.isArray(data) ? data : []).filter(ehPermissao));
});

// Para route.ts. Sessão, conta ativa e troca de senha pendente continuam em exigirPapelApi.
export async function exigirRegraApi(regra: RegraAcesso) {
  const acesso = await exigirPapelApi(TODOS_OS_PAPEIS);
  const permissoes: ReadonlySet<Permissao> = ehStaff(acesso.perfil.papel) ? await obterMinhasPermissoes() : new Set();
  if (!regraPermite(regra, acesso.perfil.papel, permissoes)) throw new ForbiddenError("Acesso negado.");
  return { ...acesso, permissoes };
}

// Para páginas e layouts do admin: sem acesso é 404, sem skeleton, como o resto do admin.
export async function exigirRegraPagina(regra: RegraInterna) {
  const acesso = await exigirPapel(PAPEIS_STAFF, { semAcesso: "404" });
  const permissoes = await obterMinhasPermissoes();
  if (!regraPermite(regra, acesso.perfil.papel, permissoes)) notFound();
  return { ...acesso, permissoes };
}

// Só para layouts e telas que qualquer conta interna ativa abre; cada seção confere a própria permissão.
export async function exigirContaInterna() {
  const acesso = await exigirPapel(PAPEIS_STAFF, { semAcesso: "404" });
  return { ...acesso, permissoes: await obterMinhasPermissoes() };
}
