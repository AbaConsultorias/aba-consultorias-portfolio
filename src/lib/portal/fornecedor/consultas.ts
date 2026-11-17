import "server-only";
import { cache } from "react";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import { ler, paginacao, paginaDe } from "@/lib/portal/andamento/servidor";
import { CAMPOS_ITEM, CAMPOS_PARCELA, itemSchema, parcelaSchema } from "@/lib/portal/financeiro/campos";
import { resumir } from "@/lib/portal/financeiro/regras";
import type { ConsultaPagina, Pagina, UUID } from "../comum/tipos";
import type { ResumoFinanceiro } from "../financeiro/tipos";
import { conferirErro } from "./erros";
import { CAMPOS_CONTRATO, CAMPOS_DOCUMENTO, CAMPOS_FORNECEDOR, contratoSchema, documentoSchema, fornecedorSchema } from "./campos";
import type { ContratoFornecedor, ContratoFornecedorAdmin, DocumentoFornecedor, FornecedorAdmin, FornecedorPortal, ItemFornecedor, StatusDocumento } from "./tipos";

async function todas<T>(schema: z.ZodType<T>, buscar: (inicio: number, fim: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const registros: T[] = [];
  for (let inicio = 0; ; inicio += 100) {
    const { data, error } = await buscar(inicio, inicio + 99);
    conferirErro(error);
    const linhas = ler(schema.array(), data);
    registros.push(...linhas);
    if (linhas.length < 100) return registros;
  }
}

async function nomesEmpreendimentos(db: Awaited<ReturnType<typeof createClient>>, ids: (UUID | null)[]) {
  const nomes = new Map<UUID, string | null>();
  for (const id of new Set(ids.filter((id): id is string => id !== null))) {
    const { data, error } = await db.rpc("nome_empreendimento", { p_empreendimento: id });
    conferirErro(error);
    nomes.set(id, ler(z.string().nullable(), data as unknown));
  }
  return nomes;
}

export const listarMeusFornecedores = cache(async (): Promise<FornecedorPortal[]> => {
  const db = await createClient();
  const linhas = await todas(fornecedorSchema, (inicio, fim) => db.from("fornecedores").select(CAMPOS_FORNECEDOR).order("razao_social").order("id").range(inicio, fim));
  return linhas.map((f) => ({ id: f.id, nome: f.nomeFantasia ?? f.razaoSocial, razaoSocial: f.razaoSocial, cnpj: f.cnpj, observacao: f.observacao }));
});

export const obterFinanceiroFornecedor = cache(async (): Promise<{ itens: ItemFornecedor[]; resumo: ResumoFinanceiro }> => {
  const db = await createClient();
  const [itens, parcelas, fornecedores] = await Promise.all([
    todas(itemSchema.extend({ empreendimentoId: z.uuid() }), (inicio, fim) => db.from("itens_financeiros").select(`${CAMPOS_ITEM},empreendimentoId:empreendimento_id`).order("descricao").order("id").range(inicio, fim)),
    todas(parcelaSchema.extend({ observacao: z.string().nullable() }), (inicio, fim) => db.from("parcelas").select(`${CAMPOS_PARCELA},observacao`).order("numero", { nullsFirst: false }).order("vencimento", { nullsFirst: false }).order("id").range(inicio, fim)),
    listarMeusFornecedores(),
  ]);
  const nomes = await nomesEmpreendimentos(db, itens.map((item) => item.empreendimentoId));
  const registros: ItemFornecedor[] = itens.map((item) => ({ ...item, empreendimentoNome: nomes.get(item.empreendimentoId) ?? null, fornecedorNome: fornecedores.find((f) => f.id === item.fornecedorId)?.nome ?? null, parcelas: parcelas.filter((p) => p.itemId === item.id) }));
  return { itens: registros, resumo: resumir(registros) };
});

export async function listarFornecedoresAdmin(consulta: ConsultaPagina = {}): Promise<Pagina<FornecedorAdmin>> {
  const db = await createClient();
  const { inicio, pagina, limite } = paginacao(consulta);
  const { data, error } = await db.from("fornecedores").select(CAMPOS_FORNECEDOR).order("razao_social").order("id").range(inicio, inicio + limite);
  conferirErro(error);
  return paginaDe(ler(fornecedorSchema.array(), data as unknown).map((f) => ({ ...f, nome: f.nomeFantasia ?? f.razaoSocial })), pagina, limite);
}

export async function obterFornecedorAdmin(id: UUID): Promise<FornecedorAdmin | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const db = await createClient();
  const { data, error } = await db.from("fornecedores").select(CAMPOS_FORNECEDOR).eq("id", id).maybeSingle();
  conferirErro(error);
  if (!data) return null;
  const f = ler(fornecedorSchema, data as unknown);
  return { ...f, nome: f.nomeFantasia ?? f.razaoSocial };
}

export async function listarMeusContratos(consulta: ConsultaPagina = {}): Promise<Pagina<ContratoFornecedor>> {
  const db = await createClient();
  const { inicio, pagina, limite } = paginacao(consulta);
  const { data, error } = await db.from("fornecedor_contratos").select(CAMPOS_CONTRATO).order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  conferirErro(error);
  const linhas = ler(contratoSchema.array(), data as unknown);
  const nomes = await nomesEmpreendimentos(db, linhas.map((l) => l.empreendimentoId));
  return paginaDe(linhas.map(({ empreendimentoId, ...l }) => ({ ...l, empreendimentoNome: empreendimentoId ? nomes.get(empreendimentoId) ?? null : null, downloadHref: `/api/portal/fornecedor-contratos/${l.id}/download` })), pagina, limite);
}

export async function listarContratosAdmin(fornecedorId: UUID): Promise<ContratoFornecedorAdmin[]> {
  const db = await createClient();
  const linhas = await todas(contratoSchema, (inicio, fim) => db.from("fornecedor_contratos").select(CAMPOS_CONTRATO).eq("fornecedor_id", fornecedorId).order("criado_em", { ascending: false }).order("id").range(inicio, fim));
  const nomes = await nomesEmpreendimentos(db, linhas.map((l) => l.empreendimentoId));
  return linhas.map((l) => ({ ...l, empreendimentoNome: l.empreendimentoId ? nomes.get(l.empreendimentoId) ?? null : null, downloadHref: `/api/portal/fornecedor-contratos/${l.id}/download` }));
}

export async function listarDocumentosAdmin(filtro: { status?: StatusDocumento; fornecedorId?: UUID }, consulta: ConsultaPagina = {}): Promise<Pagina<DocumentoFornecedor>> {
  const db = await createClient();
  const { inicio, pagina, limite } = paginacao(consulta);
  let query = db.from("fornecedor_documentos").select(CAMPOS_DOCUMENTO).order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  if (filtro.status) query = query.eq("status", filtro.status);
  if (filtro.fornecedorId) query = query.eq("fornecedor_id", filtro.fornecedorId);
  const { data, error } = await query;
  conferirErro(error);
  const linhas = ler(documentoSchema.array(), data as unknown);
  const nomes = await nomesEmpreendimentos(db, linhas.map((l) => l.empreendimentoId));
  return paginaDe(linhas.map(({ empreendimentoId, ...l }) => ({ ...l, empreendimentoNome: empreendimentoId ? nomes.get(empreendimentoId) ?? null : null, downloadHref: `/api/portal/fornecedor-documentos/${l.id}/download` })), pagina, limite);
}

export async function listarMeusDocumentos(consulta: ConsultaPagina = {}): Promise<Pagina<DocumentoFornecedor>> {
  return listarDocumentosAdmin({}, consulta);
}
