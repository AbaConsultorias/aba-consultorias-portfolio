import "server-only";
import z from "zod";
import { ForbiddenError, InternalServerError } from "@/app/api/HttpErrors";
import { falhaDeBanco, idsComVersaoMaisNova, listarFila } from "@/lib/portal/conector/consultas";
import { planejarLote, type ItemFila, type LinhaLote, type ResultadoLote } from "@/lib/portal/conector/fila";
import type { Pagina } from "@/lib/portal/comum/tipos";
import { createClient } from "@/lib/supabase/server";
import type { ConsultaInput, IgnorarInput, LiberarInput } from "./schema";

const CODIGO_SEM_PERMISSAO = "42501";

const linhaLoteSchema = z.object({
  id: z.uuid(),
  familia_id: z.uuid(),
  substitui_id: z.uuid().nullable(),
  criado_em: z.string(),
  mime: z.string(),
  liberado_cliente: z.boolean(),
});
const idSchema = z.object({ id: z.uuid() });

export function listar(consulta: ConsultaInput): Promise<Pagina<ItemFila>> {
  return listarFila({ empreendimentoId: consulta.empreendimentoId }, { pagina: consulta.pagina, limite: consulta.limite });
}

const MOTIVOS: Record<string, string> = {
  ja_liberado: "Já está liberado.",
  fora_da_fila: "Não está mais na fila (ignorado, removido ou não veio do servidor).",
  versao_mais_nova: "Existe uma versão mais nova deste arquivo.",
};

// Quem decide é o banco (liberar_documento_do_servidor): sob o lock da família, confere que o documento está na fila
// (oculto, com origem, não ignorado) e que não há versão mais nova, e libera; o trigger oculta as outras versões.
// O plano aqui só evita chamadas inúteis e, com duas versões da mesma família no lote, manda só a mais nova.
export async function liberarLote({ ids }: LiberarInput): Promise<ResultadoLote> {
  const sessao = await createClient();

  // !inner: documento sem documento_origens não volta, então cai em "não veio do servidor".
  const { data, error } = await sessao.from("documentos")
    .select("id,familia_id,substitui_id,criado_em,mime,liberado_cliente,origem:documento_origens!inner(id)")
    .in("id", ids).is("origem.ignorado_em", null);
  if (error) return falhaDeBanco("lote: documentos", error);
  const lidas = linhaLoteSchema.array().safeParse(data as unknown);
  if (!lidas.success) throw new InternalServerError(null);

  const comMaisNova = await idsComVersaoMaisNova(sessao, lidas.data.map((linha) => ({
    id: linha.id, familiaId: linha.familia_id, criadoEm: linha.criado_em,
  })));

  const linhas: LinhaLote[] = lidas.data.map((linha) => ({
    id: linha.id,
    familiaId: linha.familia_id,
    substituiId: linha.substitui_id,
    criadoEm: linha.criado_em,
    mime: linha.mime,
    liberado: linha.liberado_cliente,
    temVersaoMaisNova: comMaisNova.has(linha.id),
  }));
  const plano = planejarLote(ids, linhas);
  const resultado: ResultadoLote = { liberados: [], ignorados: plano.ignorados, falhas: [] };

  for (const id of [...plano.revisoes, ...plano.diretos]) {
    const { data: situacao, error: erroLiberacao } = await sessao.rpc("liberar_documento_do_servidor", { p_documento: id });
    if (erroLiberacao?.code === CODIGO_SEM_PERMISSAO) throw new ForbiddenError("Acesso negado.");
    if (erroLiberacao || typeof situacao !== "string") {
      console.error("[conector] admin: liberar da fila:", erroLiberacao?.code);
      resultado.falhas.push(id);
    } else if (situacao === "liberado") {
      resultado.liberados.push(id);
    } else {
      resultado.ignorados.push({ id, motivo: MOTIVOS[situacao] ?? "Não foi liberado." });
    }
  }
  return resultado;
}

// Ignorar tira da fila sem apagar nem liberar: grava documento_origens.ignorado_em (o banco carimba data e autor).
// Só vale para documento ainda oculto; o que já foi liberado ou não veio do servidor fica de fora.
export async function ignorarLote({ ids }: IgnorarInput): Promise<{ ignorados: string[] }> {
  const sessao = await createClient();
  const { data: ocultos, error: erroOcultos } = await sessao.from("documentos")
    .select("id").in("id", ids).eq("liberado_cliente", false);
  if (erroOcultos) return falhaDeBanco("ignorar: documentos", erroOcultos);
  const lidos = idSchema.array().safeParse(ocultos as unknown);
  if (!lidos.success) throw new InternalServerError(null);
  const idsOcultos = lidos.data.map((linha) => linha.id);
  if (idsOcultos.length === 0) return { ignorados: [] };

  const { data, error } = await sessao.from("documento_origens")
    .update({ ignorado_em: new Date().toISOString() }).in("documento_id", idsOcultos).is("ignorado_em", null).select("documento_id");
  if (error?.code === CODIGO_SEM_PERMISSAO) throw new ForbiddenError("Acesso negado.");
  if (error) return falhaDeBanco("ignorar: origens", error);
  const marcados = z.object({ documento_id: z.uuid() }).array().safeParse(data as unknown);
  if (!marcados.success) throw new InternalServerError(null);
  return { ignorados: marcados.data.map((linha) => linha.documento_id) };
}
