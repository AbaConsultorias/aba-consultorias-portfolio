import "server-only";
import z from "zod";
import { InternalServerError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { normalizarPagina } from "@/lib/portal/documentos/consultas";
import type { ConsultaPagina, Pagina } from "@/lib/portal/comum/tipos";
import { conectorSilencioso } from "./alerta";
import { montarFila, type ItemFila, type LinhaFila, type VersaoVisivel } from "./fila";

type Sessao = Awaited<ReturnType<typeof createClient>>;

const CAMPOS_FILA = "id,empreendimento_id,projeto_id,categoria_id,grupo,pasta_rotulo,titulo,tamanho,criado_em,substitui_id,familia_id,equipamento,equipamento_papel,origem:documento_origens!inner(caminho_relativo)";
const ENVIOS_RECENTES = 50;

const versaoSchema = z.object({ id: z.uuid(), familia_id: z.uuid(), criado_em: z.string() });

// "Tem versão mais nova" = outro documento da mesma família criado depois (empate: id maior), não só o sucessor direto:
// apagar uma versão intermediária não pode fazer a mais antiga voltar à fila. A mesma regra está em
// liberar_documento_do_servidor, que é quem decide de fato.
export async function idsComVersaoMaisNova(
  sessao: Sessao,
  linhas: readonly { id: string; familiaId: string; criadoEm: string }[],
): Promise<Set<string>> {
  const familias = [...new Set(linhas.map((linha) => linha.familiaId))];
  if (familias.length === 0) return new Set();
  const { data, error } = await sessao.from("documentos").select("id,familia_id,criado_em").in("familia_id", familias);
  if (error) return falhaDeBanco("versões mais novas", error);
  const porFamilia = new Map<string, { id: string; criado: number }[]>();
  for (const versao of lerLinhas(versaoSchema, data as unknown)) {
    const lista = porFamilia.get(versao.familia_id) ?? [];
    lista.push({ id: versao.id, criado: Date.parse(versao.criado_em) });
    porFamilia.set(versao.familia_id, lista);
  }
  const resultado = new Set<string>();
  for (const linha of linhas) {
    const criado = Date.parse(linha.criadoEm);
    const maisNova = (porFamilia.get(linha.familiaId) ?? []).some((outra) => outra.id !== linha.id
      && (outra.criado > criado || (outra.criado === criado && outra.id > linha.id)));
    if (maisNova) resultado.add(linha.id);
  }
  return resultado;
}

export function falhaDeBanco(operacao: string, error: { code?: string }): never {
  console.error("[conector] admin:", operacao, error.code);
  throw new InternalServerError(null);
}

function lerLinhas<T>(schema: z.ZodType<T>, dados: unknown): T[] {
  const resultado = schema.array().safeParse(dados);
  if (!resultado.success) throw new InternalServerError(null);
  return resultado.data;
}

const origemSchema = z.object({ caminho_relativo: z.string() });
const linhaFilaSchema = z.object({
  id: z.uuid(),
  empreendimento_id: z.uuid(),
  projeto_id: z.uuid().nullable(),
  categoria_id: z.uuid().nullable(),
  grupo: z.string().nullable(),
  pasta_rotulo: z.string().nullish(),
  titulo: z.string(),
  tamanho: z.number().int().positive(),
  criado_em: z.string(),
  substitui_id: z.uuid().nullable(),
  familia_id: z.uuid(),
  equipamento: z.string().nullish(),
  equipamento_papel: z.enum(["simo", "laudo"]).nullish(),
  // documento_origens.documento_id é único: o PostgREST devolve objeto, mas aceitar lista evita quebrar se a inferência mudar.
  origem: z.union([origemSchema, z.array(origemSchema).min(1)]),
});
const idSchema = z.object({ id: z.uuid(), nome: z.string() });
const visivelSchema = z.object({ id: z.uuid(), familia_id: z.uuid(), titulo: z.string(), liberado_em: z.string().nullable() });

const unicos = (valores: (string | null)[]): string[] => [...new Set(valores.filter((valor): valor is string => valor !== null))];

async function nomesPorId(sessao: Sessao, tabela: "projetos" | "projeto_categorias_documento", ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await sessao.from(tabela).select("id,nome").in("id", ids);
  if (error) return falhaDeBanco(`nomes de ${tabela}`, error);
  return new Map(lerLinhas(idSchema, data as unknown).map((linha) => [linha.id, linha.nome]));
}

// Fila "Chegaram do servidor": documentos ocultos que têm origem. Um documento que já tem versão mais nova (substituído
// depois de liberado) sai da fila: ele fica oculto de propósito e não espera decisão. A página pode, por isso, trazer
// menos itens que o limite.
export async function listarFila(filtro: { empreendimentoId?: string }, consulta?: ConsultaPagina): Promise<Pagina<ItemFila>> {
  const { pagina, limite, inicio } = normalizarPagina(consulta);
  const sessao = await createClient();

  // Ignorado pela equipe (documento_origens.ignorado_em) sai da fila, mas continua oculto e no banco.
  let busca = sessao.from("documentos").select(CAMPOS_FILA).eq("liberado_cliente", false).eq("mime", "application/pdf")
    .is("origem.ignorado_em", null);
  if (filtro.empreendimentoId) busca = busca.eq("empreendimento_id", filtro.empreendimentoId);
  const { data, error } = await busca.order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  if (error) return falhaDeBanco("fila", error);

  const lidas = lerLinhas(linhaFilaSchema, data as unknown);
  const haProxima = lidas.length > limite;
  const linhas: LinhaFila[] = lidas.slice(0, limite).map((linha) => ({
    id: linha.id,
    empreendimentoId: linha.empreendimento_id,
    projetoId: linha.projeto_id,
    categoriaId: linha.categoria_id,
    grupo: linha.grupo,
    pastaRotulo: linha.pasta_rotulo ?? null,
    titulo: linha.titulo,
    tamanho: linha.tamanho,
    criadoEm: linha.criado_em,
    substituiId: linha.substitui_id,
    familiaId: linha.familia_id,
    equipamento: linha.equipamento ?? null,
    equipamentoPapel: linha.equipamento_papel ?? null,
    caminhoRelativo: (Array.isArray(linha.origem) ? linha.origem[0] : linha.origem).caminho_relativo,
  }));
  const proximaPagina = haProxima ? pagina + 1 : null;
  if (linhas.length === 0) return { registros: [], proximaPagina };

  const familias = unicos(linhas.filter((linha) => linha.substituiId !== null || linha.familiaId !== linha.id).map((linha) => linha.familiaId));
  const [empreendimentos, projetos, categorias, maisNovas, visiveis] = await Promise.all([
    listarOpcoesEmpreendimentos(),
    nomesPorId(sessao, "projetos", unicos(linhas.map((linha) => linha.projetoId))),
    nomesPorId(sessao, "projeto_categorias_documento", unicos(linhas.map((linha) => linha.categoriaId))),
    idsComVersaoMaisNova(sessao, linhas),
    familias.length === 0
      ? Promise.resolve({ data: [] as unknown[], error: null })
      : sessao.from("documentos").select("id,familia_id,titulo,liberado_em").in("familia_id", familias).eq("liberado_cliente", true),
  ]);
  if (visiveis.error) return falhaDeBanco("versões visíveis", visiveis.error);

  const visiveisPorFamilia = new Map<string, VersaoVisivel>();
  for (const linha of lerLinhas(visivelSchema, visiveis.data as unknown)) {
    visiveisPorFamilia.set(linha.familia_id, { id: linha.id, titulo: linha.titulo, liberadoEm: linha.liberado_em });
  }

  const registros = montarFila(linhas, {
    empreendimentos: new Map(empreendimentos.map((item) => [item.id, item.nome])),
    projetos,
    categorias,
    comVersaoMaisNova: maisNovas,
    visiveisPorFamilia,
  });
  return { registros, proximaPagina };
}

const configuracaoSchema = z.object({ liberacao_automatica_geral: z.boolean() });

export async function lerLiberacaoAutomaticaGeral(sessao: Sessao): Promise<boolean> {
  const { data, error } = await sessao.from("configuracoes_conector").select("liberacao_automatica_geral").eq("unica", true).maybeSingle();
  if (error) return falhaDeBanco("configuração", error);
  const resultado = configuracaoSchema.safeParse(data as unknown);
  if (!resultado.success) throw new InternalServerError(null);
  return resultado.data.liberacao_automatica_geral;
}

export async function gravarLiberacaoAutomaticaGeral(sessao: Sessao, valor: boolean): Promise<boolean> {
  const { data, error } = await sessao.from("configuracoes_conector")
    .update({ liberacao_automatica_geral: valor }).eq("unica", true).select("liberacao_automatica_geral").maybeSingle();
  if (error) return falhaDeBanco("alteração da configuração", error);
  const resultado = configuracaoSchema.safeParse(data as unknown);
  if (!resultado.success) throw new InternalServerError(null);
  return resultado.data.liberacao_automatica_geral;
}

const empreendimentoComCodigoSchema = z.object({ nome: z.string(), codigo_pasta: z.string() });

// Código de pasta (6 dígitos) → nome do empreendimento, para mostrar os erros do ciclo com nome de gente.
export async function nomesPorCodigoDePasta(sessao: Sessao): Promise<Map<string, string>> {
  const { data, error } = await sessao.from("empreendimentos").select("nome,codigo_pasta").not("codigo_pasta", "is", null).limit(500);
  if (error) return falhaDeBanco("códigos de pasta", error);
  return new Map(lerLinhas(empreendimentoComCodigoSchema, data as unknown).map((linha) => [linha.codigo_pasta, linha.nome]));
}

const envioSchema = z.object({
  id: z.uuid(),
  estado: z.enum(["autorizado", "confirmado", "recusado", "duplicado"]),
  caminho_relativo: z.string(),
  erro: z.string().nullable(),
  em: z.string(),
  empreendimento_id: z.uuid(),
});

export type EnvioRecente = {
  id: string;
  estado: "autorizado" | "confirmado" | "recusado" | "duplicado";
  caminho: string;
  erro: string | null;
  em: string;
  empreendimentoId: string;
};

export async function listarEnviosRecentes(sessao: Sessao): Promise<EnvioRecente[]> {
  const { data, error } = await sessao.from("conector_envios").select("id,estado,caminho_relativo,erro,em,empreendimento_id")
    .order("em", { ascending: false }).order("id").limit(ENVIOS_RECENTES);
  if (error) return falhaDeBanco("envios recentes", error);
  return lerLinhas(envioSchema, data as unknown).map((linha) => ({
    id: linha.id,
    estado: linha.estado,
    caminho: linha.caminho_relativo,
    erro: linha.erro,
    em: linha.em,
    empreendimentoId: linha.empreendimento_id,
  }));
}

const contatoSchema = z.object({ ultimo_contato_em: z.string().nullable(), criado_em: z.string() });

// Consulta leve do aviso que aparece em todo o admin: nunca derruba a página. Qualquer falha (banco, formato) vira "sem aviso".
export async function conectorParadoHaMuito(agora: Date = new Date()): Promise<{ ultimoContatoEm: string | null } | null> {
  try {
    const sessao = await createClient();
    const { data, error } = await sessao.from("conectores").select("ultimo_contato_em,criado_em").is("revogado_em", null).maybeSingle();
    if (error || data === null) return null;
    const resultado = contatoSchema.safeParse(data as unknown);
    if (!resultado.success) return null;
    const { ultimo_contato_em: ultimoContatoEm, criado_em: criadoEm } = resultado.data;
    return conectorSilencioso({ ultimoContatoEm, criadoEm }, agora) ? { ultimoContatoEm } : null;
  } catch {
    return null;
  }
}
