import "server-only";
import { cache } from "react";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import type { ConsultaPagina, Pagina, UUID } from "../comum/tipos";
import type { DocumentoAdmin, DocumentoPortal, EstruturaDocumentos } from "./tipos";

const PADRAO = 50;
const MAXIMO = 100;
const CAMPOS_CLIENTE = "id,titulo,projeto_id,categoria_id,grupo,pasta_rotulo,tamanho,liberado_em,equipamento,equipamento_papel";

export const CAMPOS_DOCUMENTO_ADMIN = "id,empreendimento_id,projeto_id,categoria_id,grupo,pasta_rotulo,titulo,mime,tamanho,sha256,liberado_cliente,liberado_em,criado_em,equipamento,equipamento_papel";

const grupoSchema = z.enum(["contratos", "orcamentos", "arquivo"]).nullable();
const pastaRotuloSchema = z.string().nullish();
const equipamentoSchema = z.string().nullish();
const papelSchema = z.enum(["simo", "laudo"]).nullish();
const clienteSchema = z.object({
  id: z.uuid(),
  titulo: z.string(),
  projeto_id: z.uuid().nullable(),
  categoria_id: z.uuid().nullable(),
  grupo: grupoSchema,
  pasta_rotulo: pastaRotuloSchema,
  tamanho: z.number().int().positive(),
  liberado_em: z.string().nullable(),
  equipamento: equipamentoSchema,
  equipamento_papel: papelSchema,
});
export const documentoAdminSchema = z.object({
  id: z.uuid(),
  empreendimento_id: z.uuid(),
  projeto_id: z.uuid().nullable(),
  categoria_id: z.uuid().nullable(),
  grupo: grupoSchema,
  pasta_rotulo: pastaRotuloSchema,
  titulo: z.string(),
  mime: z.string(),
  tamanho: z.number().int().positive(),
  sha256: z.string().nullable(),
  liberado_cliente: z.boolean(),
  liberado_em: z.string().nullable(),
  criado_em: z.string(),
  equipamento: equipamentoSchema,
  equipamento_papel: papelSchema,
});
const projetoSchema = z.object({ id: z.uuid(), nome: z.string(), projeto_pai_id: z.uuid().nullable(), ordem: z.number().int().min(0) });
const categoriaSchema = z.object({ id: z.uuid(), projeto_id: z.uuid(), nome: z.string(), ordem: z.number().int() });

export function normalizarPagina(consulta: ConsultaPagina = {}): { pagina: number; limite: number; inicio: number } {
  const pagina = Number.isInteger(consulta.pagina) && consulta.pagina! >= 1 ? consulta.pagina! : 1;
  const limite = Number.isInteger(consulta.limite) && consulta.limite! >= 1 ? Math.min(consulta.limite!, MAXIMO) : PADRAO;
  return { pagina, limite, inicio: (pagina - 1) * limite };
}

export function falhaDeBanco(error: { code?: string }): never {
  console.error("[portal] documentos:", error.code);
  throw new InternalServerError(null);
}

function lerLinhas<T>(schema: z.ZodType<T>, dados: unknown): T[] {
  const resultado = schema.array().safeParse(dados);
  if (!resultado.success) throw new InternalServerError(null);
  return resultado.data;
}

// Busca limite + 1 linhas só para saber se existe próxima página, sem count.
function recortar<T>(linhas: T[], limite: number, pagina: number): Pagina<T> {
  return { registros: linhas.slice(0, limite), proximaPagina: linhas.length > limite ? pagina + 1 : null };
}

export function paraAdmin(linha: z.infer<typeof documentoAdminSchema>): DocumentoAdmin {
  return {
    id: linha.id,
    empreendimentoId: linha.empreendimento_id,
    projetoId: linha.projeto_id,
    categoriaId: linha.categoria_id,
    grupo: linha.grupo,
    pastaRotulo: linha.pasta_rotulo ?? null,
    titulo: linha.titulo,
    mime: linha.mime,
    tamanho: linha.tamanho,
    sha256: linha.sha256,
    liberadoCliente: linha.liberado_cliente,
    liberadoEm: linha.liberado_em,
    criadoEm: linha.criado_em,
    equipamento: linha.equipamento ?? null,
    equipamentoPapel: linha.equipamento_papel ?? null,
  };
}

// Teto de segurança da aba Documentos do cliente, que mostra tudo de uma vez (sem páginas). Lido em blocos de 1000,
// o máximo que o PostgREST devolve por pedido.
export const MAXIMO_DOCUMENTOS_CLIENTE = 3000;
const BLOCO = 1000;

export const listarTodosDocumentos = cache(async (empreendimentoId: UUID): Promise<{ documentos: DocumentoPortal[]; cortado: boolean }> => {
  if (!z.uuid().safeParse(empreendimentoId).success) return { documentos: [], cortado: false };
  const sessao = await createClient();
  const linhas: z.infer<typeof clienteSchema>[] = [];
  for (let inicio = 0; inicio < MAXIMO_DOCUMENTOS_CLIENTE; inicio += BLOCO) {
    const { data, error } = await sessao.from("documentos").select(CAMPOS_CLIENTE)
      .eq("empreendimento_id", empreendimentoId).eq("liberado_cliente", true).eq("mime", "application/pdf")
      .order("liberado_em", { ascending: false }).order("id").range(inicio, inicio + BLOCO - 1);
    if (error) falhaDeBanco(error);
    const bloco = lerLinhas(clienteSchema, data as unknown);
    linhas.push(...bloco);
    if (bloco.length < BLOCO) break;
  }
  return {
    cortado: linhas.length >= MAXIMO_DOCUMENTOS_CLIENTE,
    documentos: linhas.slice(0, MAXIMO_DOCUMENTOS_CLIENTE).map((linha) => ({
      id: linha.id,
      titulo: linha.titulo,
      projetoId: linha.projeto_id,
      categoriaId: linha.categoria_id,
      grupo: linha.grupo,
      pastaRotulo: linha.pasta_rotulo ?? null,
      tamanho: linha.tamanho,
      liberadoEm: linha.liberado_em,
      equipamento: linha.equipamento ?? null,
      equipamentoPapel: linha.equipamento_papel ?? null,
      downloadHref: `/api/portal/documentos/${linha.id}/download`,
    })),
  };
});

export const listarDocumentos = cache(async (
  empreendimentoId: UUID,
  consulta?: ConsultaPagina,
  projetoId?: UUID,
): Promise<Pagina<DocumentoPortal>> => {
  if (!z.uuid().safeParse(empreendimentoId).success) return { registros: [], proximaPagina: null };
  if (projetoId !== undefined && !z.uuid().safeParse(projetoId).success) return { registros: [], proximaPagina: null };
  const { pagina, limite, inicio } = normalizarPagina(consulta);
  const sessao = await createClient();
  let busca = sessao.from("documentos").select(CAMPOS_CLIENTE)
    .eq("empreendimento_id", empreendimentoId).eq("liberado_cliente", true).eq("mime", "application/pdf");
  if (projetoId) busca = busca.eq("projeto_id", projetoId);
  const { data, error } = await busca.order("liberado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  if (error) falhaDeBanco(error);
  const linhas = lerLinhas(clienteSchema, data as unknown);
  return recortar(linhas.map((linha) => ({
    id: linha.id,
    titulo: linha.titulo,
    projetoId: linha.projeto_id,
    categoriaId: linha.categoria_id,
    grupo: linha.grupo,
    pastaRotulo: linha.pasta_rotulo ?? null,
    tamanho: linha.tamanho,
    liberadoEm: linha.liberado_em,
    equipamento: linha.equipamento ?? null,
    equipamentoPapel: linha.equipamento_papel ?? null,
    downloadHref: `/api/portal/documentos/${linha.id}/download`,
  })), limite, pagina);
});

export async function listarDocumentosAdmin(
  filtro: { empreendimentoId?: UUID; projetoId?: UUID; liberado?: boolean },
  consulta?: ConsultaPagina,
): Promise<Pagina<DocumentoAdmin>> {
  const { pagina, limite, inicio } = normalizarPagina(consulta);
  const sessao = await createClient();
  let busca = sessao.from("documentos").select(CAMPOS_DOCUMENTO_ADMIN);
  if (filtro.empreendimentoId) busca = busca.eq("empreendimento_id", filtro.empreendimentoId);
  if (filtro.projetoId) busca = busca.eq("projeto_id", filtro.projetoId);
  if (filtro.liberado !== undefined) busca = busca.eq("liberado_cliente", filtro.liberado);
  const { data, error } = await busca.order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  if (error) falhaDeBanco(error);
  return recortar(lerLinhas(documentoAdminSchema, data as unknown).map(paraAdmin), limite, pagina);
}

export const listarEstruturaDocumentos = cache(async (empreendimentoId: UUID): Promise<EstruturaDocumentos> => {
  if (!z.uuid().safeParse(empreendimentoId).success) return { projetos: [], categorias: [] };
  const sessao = await createClient();
  const projetos = await sessao.from("projetos").select("id,nome,projeto_pai_id,ordem").eq("empreendimento_id", empreendimentoId)
    .order("ordem").order("nome").order("id").limit(MAXIMO);
  if (projetos.error) falhaDeBanco(projetos.error);
  const listaProjetos = lerLinhas(projetoSchema, projetos.data as unknown);
  if (listaProjetos.length === 0) return { projetos: [], categorias: [] };
  const categorias = await sessao.from("projeto_categorias_documento").select("id,projeto_id,nome,ordem")
    .in("projeto_id", listaProjetos.map((projeto) => projeto.id)).order("ordem").order("id").limit(1000);
  if (categorias.error) falhaDeBanco(categorias.error);
  return {
    projetos: listaProjetos.map((linha) => ({ id: linha.id, nome: linha.nome, projetoPaiId: linha.projeto_pai_id, ordem: linha.ordem })),
    categorias: lerLinhas(categoriaSchema, categorias.data as unknown)
      .map((linha) => ({ id: linha.id, projetoId: linha.projeto_id, nome: linha.nome, ordem: linha.ordem })),
  };
});
