import "server-only";
import { cache } from "react";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import type { UUID } from "../comum/tipos";
import { CAMPOS_ITEM, CAMPOS_PARCELA, centavosSchema, dataCivilSchema, itemSchema, parcelaSchema, tipoEventoSchema } from "./campos";
import { compararParcelas, resumir, semAcento } from "./regras";
import type {
  DocumentoDoContrato, EventoFinanceiro, ItemFinanceiroPortal, MarcosDoProjeto, ParcelaACobrar, ParcelaPortal, ProjetoDoContrato, ResumoFinanceiro,
} from "./tipos";

const TAMANHO_PAGINA = 100;
const EVENTOS_DESFEITOS_RECENTES = 20;
function falhar(codigo: string | undefined): never {
  console.error("[portal] consulta financeira:", codigo);
  throw new InternalServerError(null);
}

async function lerTodasAsPaginas<T>(
  esquema: z.ZodType<T>,
  buscar: (inicio: number, fim: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
): Promise<T[]> {
  const registros: T[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data: pagina, error } = await buscar(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) falhar(error.code);
    const resultado = esquema.array().safeParse(pagina as unknown);
    if (!resultado.success) falhar("formato");
    registros.push(...resultado.data);
    if (resultado.data.length < TAMANHO_PAGINA) return registros;
  }
}

const projetoDoItemSchema = z.object({
  itemId: z.uuid(),
  projetos: z.object({ id: z.uuid(), nome: z.string() }).nullable(),
});

export const obterFinanceiro = cache(async (empreendimentoId: UUID): Promise<{
  itens: ItemFinanceiroPortal[];
  resumo: ResumoFinanceiro;
}> => {
  const vazio = { itens: [], resumo: resumir([]) };
  if (!z.uuid().safeParse(empreendimentoId).success) return vazio;
  const sessao = await createClient();

  const itens = await lerTodasAsPaginas(itemSchema, (inicio, fim) => sessao
    .from("itens_financeiros").select(CAMPOS_ITEM)
    .eq("empreendimento_id", empreendimentoId)
    .order("descricao").order("id").range(inicio, fim));

  const parcelas: ParcelaPortal[] = await lerTodasAsPaginas(parcelaSchema, (inicio, fim) => sessao
    .from("parcelas").select(`${CAMPOS_PARCELA},itens_financeiros!inner(empreendimento_id)`)
    .eq("itens_financeiros.empreendimento_id", empreendimentoId)
    .order("numero", { nullsFirst: false }).order("vencimento", { nullsFirst: false }).order("id").range(inicio, fim));

  const vinculos = await lerTodasAsPaginas(projetoDoItemSchema, (inicio, fim) => sessao
    .from("item_financeiro_projetos").select("itemId:item_id,projetos(id,nome),itens_financeiros!inner(empreendimento_id)")
    .eq("itens_financeiros.empreendimento_id", empreendimentoId)
    .order("item_id").order("projeto_id").range(inicio, fim));

  const nomes = new Map<UUID, string | null>();
  for (const fornecedorId of new Set(itens.flatMap((item) => item.fornecedorId ?? []))) {
    const { data: nome, error } = await sessao.rpc("nome_fornecedor", { p_fornecedor: fornecedorId });
    if (error) falhar(error.code);
    nomes.set(fornecedorId, typeof nome === "string" ? nome : null);
  }

  const parcelasPorItem = new Map<UUID, ParcelaPortal[]>();
  for (const parcela of parcelas) {
    parcelasPorItem.set(parcela.itemId, [...(parcelasPorItem.get(parcela.itemId) ?? []), parcela]);
  }
  const projetosPorItem = new Map<UUID, ProjetoDoContrato[]>();
  for (const { itemId, projetos } of vinculos) {
    if (projetos) projetosPorItem.set(itemId, [...(projetosPorItem.get(itemId) ?? []), projetos]);
  }
  const itensPortal = itens.map((item): ItemFinanceiroPortal => ({
    ...item,
    fornecedorNome: item.fornecedorId ? nomes.get(item.fornecedorId) ?? null : null,
    projetos: (projetosPorItem.get(item.id) ?? []).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    parcelas: (parcelasPorItem.get(item.id) ?? []).sort(compararParcelas),
  }));
  return { itens: itensPortal, resumo: resumir(itensPortal) };
});

export async function listarObservacoesParcelas(empreendimentoId: UUID): Promise<Record<UUID, string | null>> {
  if (!z.uuid().safeParse(empreendimentoId).success) return {};
  const sessao = await createClient();
  const linhas = await lerTodasAsPaginas(z.object({ id: z.uuid(), observacao: z.string().nullable() }), (inicio, fim) => sessao
    .from("parcelas").select("id,observacao,itens_financeiros!inner(empreendimento_id)")
    .eq("itens_financeiros.empreendimento_id", empreendimentoId)
    .order("id").range(inicio, fim));
  return Object.fromEntries(linhas.map((linha) => [linha.id, linha.observacao]));
}

const eventoSchema = z.object({
  id: z.uuid(),
  tipo: tipoEventoSchema,
  projetoId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  parcelaId: z.uuid().nullable(),
  ocorridoEm: dataCivilSchema,
  origem: z.enum(["etapas", "botao", "contrato", "protocolo"]),
  criadoPor: z.uuid().nullable(),
  desfeitoEm: z.string().nullable(),
});
const CAMPOS_EVENTO = "id,tipo,projetoId:projeto_id,itemId:item_id,parcelaId:parcela_id,ocorridoEm:ocorrido_em,origem,criadoPor:criado_por,desfeitoEm:desfeito_em";

// Eventos ativos e os últimos desfeitos. Quem marcou aparece só para a equipe (financeiro.ver): o cliente não lê esta tabela.
export async function listarEventosFinanceiros(empreendimentoId: UUID): Promise<EventoFinanceiro[]> {
  if (!z.uuid().safeParse(empreendimentoId).success) return [];
  const sessao = await createClient();
  const ativos = await lerTodasAsPaginas(eventoSchema, (inicio, fim) => sessao
    .from("financeiro_eventos").select(CAMPOS_EVENTO)
    .eq("empreendimento_id", empreendimentoId).is("desfeito_em", null)
    .order("ocorrido_em", { ascending: false }).order("id").range(inicio, fim));
  const { data, error } = await sessao
    .from("financeiro_eventos").select(CAMPOS_EVENTO)
    .eq("empreendimento_id", empreendimentoId).not("desfeito_em", "is", null)
    .order("desfeito_em", { ascending: false }).order("id").limit(EVENTOS_DESFEITOS_RECENTES);
  if (error) falhar(error.code);
  const desfeitos = eventoSchema.array().safeParse(data as unknown);
  if (!desfeitos.success) falhar("formato");

  const registros = [...ativos, ...desfeitos.data];
  const nomes = new Map<UUID, string | null>();
  for (const pessoaId of new Set(registros.flatMap((evento) => evento.criadoPor ?? []))) {
    const { data: nome, error: erroNome } = await sessao.rpc("nome_pessoa", { p_profile: pessoaId });
    if (erroNome) falhar(erroNome.code);
    nomes.set(pessoaId, typeof nome === "string" ? nome : null);
  }
  return registros.map(({ criadoPor, ...evento }) => ({ ...evento, criadoPorNome: criadoPor ? nomes.get(criadoPor) ?? null : null }));
}

// PDFs do empreendimento que podem ser o contrato assinado: sem orçamento. Quem não tem documentos.ver recebe lista vazia.
export async function listarDocumentosDoContrato(empreendimentoId: UUID): Promise<DocumentoDoContrato[]> {
  if (!z.uuid().safeParse(empreendimentoId).success) return [];
  try {
    const sessao = await createClient();
    const linhas = await lerTodasAsPaginas(z.object({ id: z.uuid(), titulo: z.string(), grupo: z.string().nullable() }), (inicio, fim) => sessao
      .from("documentos").select("id,titulo,grupo")
      .eq("empreendimento_id", empreendimentoId).eq("mime", "application/pdf")
      .order("criado_em", { ascending: false }).order("id").range(inicio, fim));
    return linhas
      .filter((linha) => linha.grupo !== "orcamentos" && !semAcento(linha.titulo).includes("orcamento"))
      .map(({ id, titulo }) => ({ id, titulo }));
  } catch {
    return [];
  }
}

const aCobrarSchema = z.object({
  parcela_id: z.uuid(),
  item_id: z.uuid(),
  empreendimento_id: z.uuid(),
  empreendimento_nome: z.string().nullable(),
  codigo: z.string().nullable(),
  versao: z.number().int().nullable(),
  descricao: z.string(),
  nome: z.string().nullable(),
  numero: z.number().int().nullable(),
  total_parcelas: z.number().int(),
  vencimento: dataCivilSchema,
  saldo_centavos: centavosSchema,
  vencida: z.boolean(),
});

export async function listarACobrar(dias = 15): Promise<ParcelaACobrar[]> {
  const sessao = await createClient();
  // Paginado como as outras leituras: o PostgREST corta em max_rows e o total do "A cobrar" ficaria incompleto.
  const linhas = await lerTodasAsPaginas(aCobrarSchema, (inicio, fim) => sessao
    .rpc("listar_a_cobrar", { p_dias: dias })
    .order("vencimento").order("empreendimento_nome").order("numero", { nullsFirst: false }).order("parcela_id")
    .range(inicio, fim));
  return linhas.map((linha) => ({
    parcelaId: linha.parcela_id,
    itemId: linha.item_id,
    empreendimentoId: linha.empreendimento_id,
    empreendimentoNome: linha.empreendimento_nome,
    codigo: linha.codigo,
    versao: linha.versao,
    descricao: linha.descricao,
    nome: linha.nome,
    numero: linha.numero,
    totalParcelas: linha.total_parcelas,
    vencimento: linha.vencimento,
    saldoCentavos: linha.saldo_centavos,
    vencida: linha.vencida,
  }));
}

const etapaMarcoSchema = z.object({
  id: z.uuid(),
  projetoId: z.uuid(),
  ordem: z.number().int(),
  marco: z.enum(["confeccao", "analise", "aprovado"]).nullable(),
});

export async function listarMarcosDosProjetos(empreendimentoId: UUID): Promise<MarcosDoProjeto[]> {
  if (!z.uuid().safeParse(empreendimentoId).success) return [];
  const sessao = await createClient();
  const projetos = await lerTodasAsPaginas(z.object({ id: z.uuid(), etapaAtualId: z.uuid().nullable() }), (inicio, fim) => sessao
    .from("projetos").select("id,etapaAtualId:etapa_atual_id")
    .eq("empreendimento_id", empreendimentoId).order("id").range(inicio, fim));
  const etapas = await lerTodasAsPaginas(etapaMarcoSchema, (inicio, fim) => sessao
    .from("projeto_etapas").select("id,projetoId:projeto_id,ordem,marco,projetos!projeto_etapas_projeto_id_fkey!inner(empreendimento_id)")
    .eq("projetos.empreendimento_id", empreendimentoId).order("projeto_id").order("ordem").order("id").range(inicio, fim));

  return projetos.map((projeto) => {
    const doProjeto = etapas.filter((etapa) => etapa.projetoId === projeto.id);
    const ordemAtual = doProjeto.find((etapa) => etapa.id === projeto.etapaAtualId)?.ordem ?? null;
    const ordemDe = (marco: "analise" | "aprovado") => doProjeto.find((etapa) => etapa.marco === marco)?.ordem ?? null;
    const analise = ordemDe("analise");
    const aprovado = ordemDe("aprovado");
    return {
      projetoId: projeto.id,
      emAnalise: ordemAtual !== null && analise !== null && ordemAtual >= analise,
      aprovado: ordemAtual !== null && aprovado !== null && ordemAtual >= aprovado,
    };
  });
}
