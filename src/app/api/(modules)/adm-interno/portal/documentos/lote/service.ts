import "server-only";
import z from "zod";
import { ForbiddenError, InternalServerError } from "@/app/api/HttpErrors";
import { falhaDeBanco } from "@/lib/portal/documentos/consultas";
import { criadoDepois, planejarAlteracaoEmLote, type LinhaLoteDocumento, type ResultadoLoteDocumentos } from "@/lib/portal/documentos/lote";
import { createClient } from "@/lib/supabase/server";
import type { LoteInput } from "./schema";

export type DependenciasLote = { criarSessao: typeof createClient };

type Sessao = Awaited<ReturnType<typeof createClient>>;
type Pagina = PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;

const dependenciasPadrao: DependenciasLote = { criarSessao: createClient };
const CODIGO_SEM_PERMISSAO = "42501";
// Teto de linhas por resposta do PostgREST: passou disso, a resposta vem cortada sem aviso.
const LINHAS_POR_PAGINA = 1000;

const linhaSchema = z.object({
  id: z.uuid(),
  familia_id: z.uuid(),
  criado_em: z.string(),
  mime: z.string(),
  liberado_cliente: z.boolean(),
});
const substituidoSchema = z.object({ substitui_id: z.uuid() });
const raizOuOrfaSchema = z.object({ id: z.uuid(), familia_id: z.uuid(), criado_em: z.string() });

async function lerTodasAsPaginas(buscar: (de: number, ate: number) => Pagina): Promise<unknown[]> {
  const linhas: unknown[] = [];
  for (let de = 0; ; de += LINHAS_POR_PAGINA) {
    const { data, error } = await buscar(de, de + LINHAS_POR_PAGINA - 1);
    if (error) return falhaDeBanco(error);
    linhas.push(...(data ?? []));
    if ((data?.length ?? 0) < LINHAS_POR_PAGINA) return linhas;
  }
}

function lerLinhas<T>(schema: z.ZodType<T>, dados: unknown[]): T[] {
  const lidas = schema.array().safeParse(dados);
  if (!lidas.success) throw new InternalServerError(null);
  return lidas.data;
}

// Uma versão é antiga se algum documento a substitui (substitui_id): vale para a revisão mais nova dentro e fora da seleção.
// A consulta devolve uma linha por sucessor direto; paginada (ordem por id) porque ramificações poderiam passar de 1000 linhas.
// Falta só o caso em que apagar uma versão do meio zerou o substitui_id da seguinte (FK ON DELETE SET NULL): a família continua
// a mesma (familia_id), mas o elo some. Esse caso é coberto pelas revisões órfãs da família (substitui_id nulo e id diferente
// de familia_id), que são poucas; uma delas criada depois da candidata também a torna antiga.
async function idsComRevisaoMaisNova(sessao: Sessao, candidatas: readonly { id: string; familia_id: string; criado_em: string }[]): Promise<Set<string>> {
  if (candidatas.length === 0) return new Set();
  const idsCandidatos = candidatas.map((linha) => linha.id);
  const familias = [...new Set(candidatas.map((linha) => linha.familia_id))];

  const substituidos = new Set(lerLinhas(substituidoSchema, await lerTodasAsPaginas((de, ate) =>
    sessao.from("documentos").select("substitui_id").in("substitui_id", idsCandidatos).order("id").range(de, ate),
  )).map((linha) => linha.substitui_id));
  const orfas = lerLinhas(raizOuOrfaSchema, await lerTodasAsPaginas((de, ate) =>
    sessao.from("documentos").select("id,familia_id,criado_em").in("familia_id", familias).is("substitui_id", null).order("id").range(de, ate),
  )).filter((linha) => linha.id !== linha.familia_id);

  return new Set(candidatas.filter((linha) => substituidos.has(linha.id) || orfas.some((orfa) => orfa.familia_id === linha.familia_id
    && criadoDepois({ id: orfa.id, criadoEm: orfa.criado_em }, { id: linha.id, criadoEm: linha.criado_em }))).map((linha) => linha.id));
}

// Com a sessão da pessoa: o RLS vale, e o que ela não enxerga cai em "não encontrado". Grava com o mesmo UPDATE do PATCH
// (liberado_por/liberado_em vêm do carimbo do banco e o trigger de família oculta as outras versões), um documento por vez,
// para uma falha não derrubar o lote. Uma revisão gravada entre a leitura e o UPDATE passa despercebida, como no PATCH individual.
export async function alterarLiberacaoEmLote(
  { ids, liberado }: LoteInput,
  dependencias: DependenciasLote = dependenciasPadrao,
): Promise<ResultadoLoteDocumentos> {
  const sessao = await dependencias.criarSessao();
  const { data, error } = await sessao.from("documentos").select("id,familia_id,criado_em,mime,liberado_cliente").in("id", ids);
  if (error) return falhaDeBanco(error);
  const lidas = linhaSchema.array().safeParse(data as unknown);
  if (!lidas.success) throw new InternalServerError(null);

  // Só quem poderia subir precisa saber se há versão mais nova.
  const candidatas = liberado ? lidas.data.filter((linha) => !linha.liberado_cliente && linha.mime === "application/pdf") : [];
  const comMaisNova = await idsComRevisaoMaisNova(sessao, candidatas);

  const linhas: LinhaLoteDocumento[] = lidas.data.map((linha) => ({
    id: linha.id,
    familiaId: linha.familia_id,
    criadoEm: linha.criado_em,
    mime: linha.mime,
    liberado: linha.liberado_cliente,
    temVersaoMaisNova: comMaisNova.has(linha.id),
  }));
  const plano = planejarAlteracaoEmLote(ids, linhas, liberado);
  const resultado: ResultadoLoteDocumentos = { alterados: [], ignorados: plano.ignorados, falhas: [] };

  for (const id of plano.alterar) {
    const { data: gravado, error: erroGravacao } = await sessao.from("documentos")
      .update({ liberado_cliente: liberado }).eq("id", id).select("id").maybeSingle();
    if (erroGravacao?.code === CODIGO_SEM_PERMISSAO) throw new ForbiddenError("Acesso negado.");
    if (erroGravacao || gravado === null) {
      console.error("[portal] documentos: lote:", erroGravacao?.code);
      resultado.falhas.push(id);
    } else {
      resultado.alterados.push(id);
    }
  }
  return resultado;
}
