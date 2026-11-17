import "server-only";
import z from "zod";
import { notFound } from "next/navigation";
import { exigirPapel } from "@/lib/auth/guard";
import { PAPEIS_STAFF } from "@/lib/auth/papeis";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import type { RegraInterna } from "@/lib/auth/regras";
import { createClient } from "@/lib/supabase/server";
import { conferirErro, ler } from "./servidor";

export async function prepararAdmin() {
  await exigirPapel(PAPEIS_STAFF, { semAcesso: "404" });
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  return adminPath;
}
export async function prepararAdminComRegra(regra: RegraInterna) {
  const acesso = await exigirRegraPagina(regra);
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  return { adminPath, ...acesso };
}
export function opcoesDeCampo(lista: readonly { id: string; nome: string }[]) {
  return lista.map(({ id, nome }) => ({ valor: id, nome }));
}
export function numeroPagina(valor: unknown) {
  const pagina = z.coerce.number().int().min(1).max(100000).safeParse(valor ?? 1);
  if (!pagina.success) notFound();
  return pagina.data;
}
export async function opcoes(tabela: "profiles" | "modelos_etapas" | "projetos" | "projeto_etapas", empreendimentoId?: string) {
  const sessao = await createClient();
  const registros: { valor: string; nome: string }[] = [];
  for (let inicio = 0; ; inicio += 100) {
    let query = sessao.from(tabela).select("id,nome").order("nome").order("id").range(inicio, inicio + 99);
    if (tabela === "profiles") query = query.eq("papel", "cliente");
    if (tabela === "modelos_etapas") query = query.eq("ativo", true);
    if (tabela === "projetos" && empreendimentoId) query = query.eq("empreendimento_id", empreendimentoId);
    const { data, error } = await query;
    conferirErro(error);
    const linhas = ler(z.object({ id: z.uuid(), nome: z.string() }).array(), data as unknown);
    registros.push(...linhas.map((linha) => ({ valor: linha.id, nome: linha.nome })));
    if (linhas.length < 100) return registros;
  }
}

// Todos os projetos do empreendimento (sem paginar), na ordem da equipe: a ordem só vale entre irmãos, então quem
// reordena precisa da lista completa de cada nível, mesmo quando a aba mostra só uma página.
export async function projetosEmOrdem(empreendimentoId: string) {
  const sessao = await createClient();
  const registros: { id: string; nome: string; projetoPaiId: string | null; ordem: number }[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await sessao.from("projetos").select("id,nome,projeto_pai_id,ordem")
      .eq("empreendimento_id", empreendimentoId).order("ordem").order("nome").order("id").range(inicio, inicio + 99);
    conferirErro(error);
    const linhas = ler(z.object({ id: z.uuid(), nome: z.string(), projeto_pai_id: z.uuid().nullable(), ordem: z.number().int().min(0) }).array(), data as unknown);
    registros.push(...linhas.map((linha) => ({ id: linha.id, nome: linha.nome, projetoPaiId: linha.projeto_pai_id, ordem: linha.ordem })));
    if (linhas.length < 100) return registros;
  }
}

export async function opcoesEtapas(empreendimentoId: string) {
  const sessao = await createClient();
  const registros: { valor: string; nome: string; projetoId: string; ordem: number }[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await sessao.from("projeto_etapas").select("id,nome,projeto_id,ordem,projetos!projeto_etapas_projeto_id_fkey!inner(empreendimento_id)")
      .eq("projetos.empreendimento_id", empreendimentoId).order("projeto_id").order("ordem").order("id").range(inicio, inicio + 99);
    conferirErro(error);
    const linhas = ler(z.object({ id: z.uuid(), nome: z.string(), projeto_id: z.uuid(), ordem: z.number().int() }).array(), data as unknown);
    registros.push(...linhas.map((linha) => ({ valor: linha.id, nome: linha.nome, projetoId: linha.projeto_id, ordem: linha.ordem })));
    if (linhas.length < 100) return registros;
  }
}
