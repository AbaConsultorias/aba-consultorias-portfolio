import "server-only";
import z from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ConsultaPagina, Pagina, UUID } from "../comum/tipos";
import type { AtualizacaoPortal, FotoPortal, ObraPortal, ProjetoPortal, RelatoObraPortal } from "./tipos";
import { calcularProgresso } from "./regras";
import { conferirErro, ler, paginacao, paginaDe } from "./servidor";

const etapaSchema = z.object({ id: z.uuid(), nome: z.string(), ordem: z.number().int(), concluida_em: z.iso.date().nullable() });
const projetoSchema = z.object({ id: z.uuid(), nome: z.string(), etapa_atual_id: z.uuid().nullable(), projeto_pai_id: z.uuid().nullable(), ordem: z.number().int().min(0) });
const CAMPOS_PROJETO = "id,nome,etapa_atual_id,projeto_pai_id,ordem";
const fotoSchema = z.object({ id: z.uuid(), mime: z.string(), atualizacao_id: z.uuid().optional(), relato_id: z.uuid().optional() });
const atualizacaoSchema = z.object({ id: z.uuid(), titulo: z.string(), texto: z.string().nullable(), data_visita: z.iso.date().nullable() });
const obraSchema = z.object({ id: z.uuid(), nome: z.string(), percentual: z.number().min(0).max(100), situacao: z.enum(["planejada", "em_andamento", "concluida"]) });
const relatoSchema = z.object({ id: z.uuid(), obra_id: z.uuid(), texto: z.string(), criado_em: z.string() });

const RELATOS_POR_PAGINA = 10;

async function listarTodas<T>(tabela: string, campos: string, filtro: string, id: string | string[], schema: z.ZodType<T>, ordem: string | string[] = "id"): Promise<T[]> {
  const sessao = await createClient();
  const linhas: T[] = [];
  const colunas = Array.isArray(ordem) ? ordem : [ordem];
  for (let inicio = 0; ; inicio += 100) {
    const base = sessao.from(tabela).select(campos);
    const filtrada = Array.isArray(id) ? base.in(filtro, id) : base.eq(filtro, id);
    const query = colunas.reduce((q, coluna) => q.order(coluna), filtrada).order("id").range(inicio, inicio + 99);
    const { data, error } = await query;
    conferirErro(error);
    const lote = ler(schema.array(), data as unknown);
    linhas.push(...lote);
    if (lote.length < 100) return linhas;
  }
}

async function montarProjeto(projeto: z.infer<typeof projetoSchema>, tentativa = 0): Promise<ProjetoPortal | null> {
  const linhas = await listarTodas("projeto_etapas", "id,nome,ordem,concluida_em", "projeto_id", projeto.id, etapaSchema, "ordem");
  const etapas = linhas.map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem, concluidaEm: e.concluida_em }));
  const referenciaValida = projeto.etapa_atual_id === null || etapas.some((e) => e.id === projeto.etapa_atual_id);
  if (!referenciaValida && tentativa === 0) {
    // Projeto e etapas vêm de leituras separadas: se a equipe salvou as etapas entre elas, a etapa atual lida já foi trocada.
    const [recarregado] = await listarTodas("projetos", CAMPOS_PROJETO, "id", projeto.id, projetoSchema);
    return recarregado ? montarProjeto(recarregado, 1) : null;
  }
  if (!referenciaValida) console.error("[portal] andamento: etapa atual fora da lista do projeto");
  return {
    id: projeto.id, nome: projeto.nome, ordem: projeto.ordem, projetoPaiId: projeto.projeto_pai_id, etapaAtualId: projeto.etapa_atual_id, etapas,
    progresso: referenciaValida ? calcularProgresso(etapas, projeto.etapa_atual_id) : 0,
  };
}

export async function listarProjetos(empreendimentoId: UUID): Promise<ProjetoPortal[]> {
  const projetos = await listarTodas("projetos", CAMPOS_PROJETO, "empreendimento_id", empreendimentoId, projetoSchema, ["ordem", "nome"]);
  const montados = await Promise.all(projetos.map((p) => montarProjeto(p)));
  return montados.filter((p): p is ProjetoPortal => p !== null);
}

async function fotosPorPai(tipo: "atualizacao" | "relato", ids: string[]) {
  const chave = `${tipo}_id` as const;
  const porPai = new Map<string, FotoPortal[]>();
  if (!ids.length) return porPai;
  const linhas = await listarTodas(`${tipo}_fotos`, `id,mime,${chave}`, chave, ids, fotoSchema, tipo === "atualizacao" ? "ordem" : "id");
  for (const f of linhas) {
    const pai = f[chave];
    if (!pai) continue;
    porPai.set(pai, [...porPai.get(pai) ?? [], { id: f.id, mime: f.mime, urlDaRota: `/api/portal/${tipo}-fotos/${f.id}` }]);
  }
  return porPai;
}

export async function listarAtualizacoes(empreendimentoId: UUID, consulta?: ConsultaPagina): Promise<Pagina<AtualizacaoPortal>> {
  const { inicio, pagina, limite } = paginacao(consulta);
  const sessao = await createClient();
  const { data, error } = await sessao.from("atualizacoes").select("id,titulo,texto,data_visita")
    .eq("empreendimento_id", empreendimentoId).eq("publicado", true).order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  conferirErro(error);
  const linhas = ler(atualizacaoSchema.array(), data as unknown);
  const resultado = paginaDe(linhas, pagina, limite);
  const fotos = await fotosPorPai("atualizacao", resultado.registros.map((a) => a.id));
  return { ...resultado, registros: resultado.registros.map((a) => ({ id: a.id, titulo: a.titulo, texto: a.texto, dataVisita: a.data_visita, fotos: fotos.get(a.id) ?? [] })) };
}

// Os relatos aprovados de todas as obras formam uma lista única, do mais novo ao mais antigo.
export async function listarObras(empreendimentoId: UUID, consulta?: ConsultaPagina): Promise<{ obras: ObraPortal[]; relatos: Pagina<RelatoObraPortal> }> {
  const { inicio, pagina, limite } = paginacao({ ...consulta, limite: consulta?.limite ?? RELATOS_POR_PAGINA });
  const obras = await listarTodas("obras", "id,nome,percentual,situacao", "empreendimento_id", empreendimentoId, obraSchema, "nome");
  if (!obras.length) return { obras, relatos: { registros: [], proximaPagina: null } };
  const sessao = await createClient();
  const { data, error } = await sessao.from("relatos_obra").select("id,obra_id,texto,criado_em")
    .in("obra_id", obras.map((o) => o.id)).eq("status", "aprovado").order("criado_em", { ascending: false }).order("id").range(inicio, inicio + limite);
  conferirErro(error);
  const resultado = paginaDe(ler(relatoSchema.array(), data as unknown), pagina, limite);
  const fotos = await fotosPorPai("relato", resultado.registros.map((r) => r.id));
  const nomes = new Map(obras.map((o) => [o.id, o.nome]));
  return {
    obras,
    relatos: {
      ...resultado,
      registros: resultado.registros.map((r) => ({ id: r.id, obraNome: nomes.get(r.obra_id) ?? "", texto: r.texto, criadoEm: r.criado_em, fotos: fotos.get(r.id) ?? [] })),
    },
  };
}
