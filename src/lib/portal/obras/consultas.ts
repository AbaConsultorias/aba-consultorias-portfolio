import "server-only";
import { cache } from "react";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { ler, paginacao, paginaDe } from "../andamento/servidor";
import type { ConsultaPagina, Pagina, UUID } from "../comum/tipos";
import { conferirErro } from "./erros";
import type { EmpreiteiroDaObra, ObraAdmin, ObraEmpreiteiro, RelatoFila, RelatoObra, StatusRelato } from "./tipos";

const situacao = z.enum(["planejada", "em_andamento", "concluida"]);
const obraSchema = z.object({ id: z.uuid(), empreendimento_id: z.uuid(), nome: z.string(), previsto_inicio: z.iso.date().nullable(), previsto_fim: z.iso.date().nullable(), situacao, percentual: z.number().int().min(0).max(100) });
const relatoSchema = z.object({ id: z.uuid(), obra_id: z.uuid(), autor_id: z.uuid(), texto: z.string(), percentual_informado: z.number().int().min(0).max(100).nullable(), situacao_informada: situacao.nullable(), status: z.enum(["pendente", "aprovado", "devolvido"]), motivo_devolucao: z.string().nullable(), criado_em: z.string(), revisado_em: z.string().nullable() });
const CAMPOS_OBRA = "id,empreendimento_id,nome,previsto_inicio,previsto_fim,situacao,percentual";
const CAMPOS_RELATO = "id,obra_id,autor_id,texto,percentual_informado,situacao_informada,status,motivo_devolucao,criado_em,revisado_em";

const nomeEmpreendimento = cache(async (id: string) => {
  const sessao = await createClient();
  const { data, error } = await sessao.rpc("nome_empreendimento", { p_empreendimento: id });
  conferirErro(error);
  return ler(z.string().nullable(), data as unknown);
});
async function converterObra(obra: z.infer<typeof obraSchema>): Promise<ObraEmpreiteiro> {
  const sessao = await createClient();
  const { count, error } = await sessao.from("relatos_obra").select("id", { count: "exact", head: true }).eq("obra_id", obra.id).eq("status", "pendente");
  conferirErro(error);
  return { id: obra.id, nome: obra.nome, empreendimentoNome: await nomeEmpreendimento(obra.empreendimento_id), previstoInicio: obra.previsto_inicio, previstoFim: obra.previsto_fim, situacao: obra.situacao, percentual: obra.percentual, relatosPendentes: ler(z.number().int().nonnegative(), count) };
}
async function converterRelato(relato: z.infer<typeof relatoSchema>): Promise<RelatoObra> {
  const sessao = await createClient();
  const { data, error } = await sessao.from("relato_fotos").select("id,mime").eq("relato_id", relato.id).order("id").limit(10);
  conferirErro(error);
  const fotos = ler(z.object({ id: z.uuid(), mime: z.string() }).array(), data as unknown);
  return { id: relato.id, obraId: relato.obra_id, texto: relato.texto, percentualInformado: relato.percentual_informado, situacaoInformada: relato.situacao_informada, status: relato.status, motivoDevolucao: relato.motivo_devolucao, criadoEm: relato.criado_em, revisadoEm: relato.revisado_em, fotos: fotos.map((foto) => ({ ...foto, urlDaRota: `/api/portal/relato-fotos/${foto.id}` })) };
}
export const obterMinhaObra = cache(async (id: UUID): Promise<ObraEmpreiteiro | null> => {
  if (!z.uuid().safeParse(id).success) return null;
  const sessao = await createClient();
  const { data, error } = await sessao.from("obras").select(CAMPOS_OBRA).eq("id", id).maybeSingle();
  conferirErro(error);
  return data ? converterObra(ler(obraSchema, data as unknown)) : null;
});
export const listarMinhasObras = cache(async (): Promise<ObraEmpreiteiro[]> => {
  const sessao = await createClient();
  const obras: ObraEmpreiteiro[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await sessao.from("obras").select(CAMPOS_OBRA).order("nome").order("id").range(inicio, inicio + 99);
    conferirErro(error);
    const linhas = ler(obraSchema.array(), data as unknown);
    obras.push(...await Promise.all(linhas.map(converterObra)));
    if (linhas.length < 100) return obras;
  }
});
export async function listarMeusRelatos(obraId: UUID, consulta?: ConsultaPagina): Promise<Pagina<RelatoObra>> {
  z.uuid().parse(obraId);
  const sessao = await createClient();
  const { inicio, pagina, limite } = paginacao(consulta);
  const { data, error } = await sessao.from("relatos_obra").select(CAMPOS_RELATO).eq("obra_id", obraId).order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  conferirErro(error);
  const resultado = paginaDe(ler(relatoSchema.array(), data as unknown), pagina, limite);
  return { ...resultado, registros: await Promise.all(resultado.registros.map(converterRelato)) };
}
export async function obterMeuRelato(id: UUID): Promise<RelatoObra | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const sessao = await createClient();
  const { data, error } = await sessao.from("relatos_obra").select(CAMPOS_RELATO).eq("id", id).maybeSingle();
  conferirErro(error);
  return data ? converterRelato(ler(relatoSchema, data as unknown)) : null;
}
export async function listarEmpreiteirosDaObra(obraId: UUID): Promise<EmpreiteiroDaObra[]> {
  z.uuid().parse(obraId);
  const sessao = await createClient();
  const registros: EmpreiteiroDaObra[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await sessao.from("obra_empreiteiros").select("id,profile_id,profiles!inner(nome,ativo)").eq("obra_id", obraId).order("id").range(inicio, inicio + 99);
    conferirErro(error);
    const linhas = ler(z.object({ id: z.uuid(), profile_id: z.uuid(), profiles: z.object({ nome: z.string(), ativo: z.boolean() }) }).array(), data as unknown);
    registros.push(...linhas.map((linha) => ({ vinculoId: linha.id, profileId: linha.profile_id, nome: linha.profiles.nome, ativo: linha.profiles.ativo })));
    if (linhas.length < 100) return registros;
  }
}
export async function listarObrasAdmin(empreendimentoId: UUID): Promise<ObraAdmin[]> {
  z.uuid().parse(empreendimentoId);
  const sessao = await createClient();
  const obras: ObraAdmin[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await sessao.from("obras").select(CAMPOS_OBRA).eq("empreendimento_id", empreendimentoId).order("nome").order("id").range(inicio, inicio + 99);
    conferirErro(error);
    const linhas = ler(obraSchema.array(), data as unknown);
    obras.push(...await Promise.all(linhas.map(async (obra) => ({ ...await converterObra(obra), empreendimentoId: obra.empreendimento_id, empreiteiros: await listarEmpreiteirosDaObra(obra.id) }))));
    if (linhas.length < 100) return obras;
  }
}
export async function listarFilaRelatos(filtro: { status?: StatusRelato; obraId?: UUID }, consulta?: ConsultaPagina): Promise<Pagina<RelatoFila>> {
  const sessao = await createClient();
  const { inicio, pagina, limite } = paginacao(consulta);
  let query = sessao.from("relatos_obra").select(`${CAMPOS_RELATO},obras!inner(${CAMPOS_OBRA})`).order("criado_em").order("id").range(inicio, inicio + limite);
  if (filtro.status) query = query.eq("status", filtro.status);
  if (filtro.obraId) query = query.eq("obra_id", filtro.obraId);
  const { data, error } = await query;
  conferirErro(error);
  const resultado = paginaDe(ler(relatoSchema.extend({ obras: obraSchema }).array(), data as unknown), pagina, limite);
  return { ...resultado, registros: await Promise.all(resultado.registros.map(async (relato) => {
    const { data: nome, error: erroNome } = await sessao.rpc("nome_pessoa", { p_profile: relato.autor_id });
    conferirErro(erroNome);
    return { ...await converterRelato(relato), obraNome: relato.obras.nome, empreendimentoNome: await nomeEmpreendimento(relato.obras.empreendimento_id), autorNome: ler(z.string().nullable(), nome as unknown), percentualAtual: relato.obras.percentual, situacaoAtual: relato.obras.situacao };
  })) };
}
