import "server-only";
import z from "zod";
import { ConflictError, ForbiddenError, NotFoundError } from "@/app/api/HttpErrors";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";
import { limitarTexto, type EtapasDoProjeto, type MudancaDeEtapa, type SugestaoDeEtapa, type SugestaoDoRecalculo } from "@/lib/portal/etapas/tipos";
import { MODOS_DE_ETAPAS, type ModoDeEtapas } from "@/lib/portal/pasta/tipos";
import { createClient } from "@/lib/supabase/server";
import { modoDeEtapas } from "../pasta-regras/service";
import type { ConfirmarInput, DesfazerInput, IgnorarInput, ModoInput, RecalculoAplicarInput, RecalculoConsultaInput } from "./schema";

// Toda leitura e escrita usa o client do usuário logado: o RLS vale e as funções do banco (security definer) conferem
// empreendimentos.editar no corpo. Nada aqui usa a secret key.
type Sessao = Awaited<ReturnType<typeof createClient>>;

const CODIGO_DE_REGRA_DE_NEGOCIO = "P0001";
const LIMITE_DE_PROJETOS = 200;
const LIMITE_DO_HISTORICO = 50;
const PROJETOS_POR_LOTE = 8;
const MENSAGEM_SO_ADMIN = "Só o administrador liga ou desliga as etapas automáticas.";
const ORIGENS = ["manual", "sugestao", "automatico", "recalculo", "desfazer"] as const;
const ORIGENS_QUE_SE_DESFAZEM: readonly string[] = ["sugestao", "automatico", "recalculo"];
const TIPOS_DE_SINAL = ["protocolo", "devolutiva", "aprovado"] as const;

// As mensagens P0001 das funções do banco são de negócio e em português ("Esta sugestão não vale mais."): podem ser mostradas.
function tratarErro(error: unknown): void {
  const erro = z.object({ code: z.string().optional(), message: z.string().optional() }).safeParse(error);
  if (erro.success && erro.data.code === CODIGO_DE_REGRA_DE_NEGOCIO && erro.data.message) throw new ConflictError(erro.data.message.slice(0, 300));
  conferirErro(error);
}

const umOuLista = <T>(valor: T | T[] | null | undefined): T | null => (Array.isArray(valor) ? valor[0] ?? null : valor ?? null);
const tituloEmbutido = z.object({ titulo: z.string() });
const documentoEmbutido = z.union([tituloEmbutido, tituloEmbutido.array()]).nullable();
const tituloDoDocumento = (documentos: z.infer<typeof documentoEmbutido>): string | null => {
  const titulo = umOuLista(documentos)?.titulo;
  return titulo ? limitarTexto(titulo) : null;
};

// O nome do arquivo vem do documento: quem não tem documentos.ver recebe vazio do RLS e a tela diz só "um arquivo novo".
async function arquivosDosSinais(sessao: Sessao, sinalIds: readonly string[]): Promise<Map<string, string | null>> {
  const arquivos = new Map<string, string | null>();
  if (sinalIds.length === 0) return arquivos;
  const { data, error } = await sessao.from("etapa_sinais").select("id,documentos(titulo)").in("id", [...sinalIds]).limit(sinalIds.length);
  conferirErro(error);
  for (const linha of ler(z.object({ id: z.uuid(), documentos: documentoEmbutido }).array(), data as unknown)) arquivos.set(linha.id, tituloDoDocumento(linha.documentos));
  return arquivos;
}

const sugestaoSchema = z.object({ sinal_id: z.uuid(), tipo: z.enum(TIPOS_DE_SINAL), etapa_id: z.uuid(), etapa_nome: z.string(), data_arquivo: z.string() });

// A sugestão é calculada pelo banco, projeto a projeto (sugestao_etapa exige empreendimentos.ver); em lotes pequenos para
// não abrir dezenas de consultas ao mesmo tempo. Os nomes dos arquivos vêm numa consulta só.
export async function sugestoesDosProjetos(projetoIds: readonly string[], sessao: Sessao): Promise<Map<string, SugestaoDeEtapa>> {
  const linhas = new Map<string, z.infer<typeof sugestaoSchema>>();
  for (let inicio = 0; inicio < projetoIds.length; inicio += PROJETOS_POR_LOTE) {
    const lote = projetoIds.slice(inicio, inicio + PROJETOS_POR_LOTE);
    const respostas = await Promise.all(lote.map(async (projetoId) => {
      const { data, error } = await sessao.rpc("sugestao_etapa", { p_projeto: projetoId });
      tratarErro(error);
      return ler(sugestaoSchema.array(), data as unknown)[0] ?? null;
    }));
    lote.forEach((projetoId, indice) => {
      const linha = respostas[indice];
      if (linha) linhas.set(projetoId, linha);
    });
  }
  const arquivos = await arquivosDosSinais(sessao, [...linhas.values()].map((linha) => linha.sinal_id));
  const sugestoes = new Map<string, SugestaoDeEtapa>();
  for (const [projetoId, linha] of linhas) {
    sugestoes.set(projetoId, {
      sinalId: linha.sinal_id,
      tipo: linha.tipo,
      etapaId: linha.etapa_id,
      etapaNome: limitarTexto(linha.etapa_nome),
      dataArquivo: linha.data_arquivo,
      arquivo: arquivos.get(linha.sinal_id) ?? null,
    });
  }
  return sugestoes;
}

export async function sugestaoDoProjeto(projetoId: string, sessao: Sessao): Promise<SugestaoDeEtapa | null> {
  return (await sugestoesDosProjetos([projetoId], sessao)).get(projetoId) ?? null;
}

// Aba Projetos do empreendimento: as sugestões dos projetos da página, só com o modo ligado. Falha de leitura não derruba a aba.
export async function sugestoesDaPagina(empreendimentoId: string, projetoIds: readonly string[]): Promise<Map<string, SugestaoDeEtapa>> {
  try {
    const sessao = await createClient();
    if (projetoIds.length === 0 || await modoDeEtapas(empreendimentoId, sessao) === "desligado") return new Map();
    return await sugestoesDosProjetos(projetoIds, sessao);
  } catch {
    return new Map();
  }
}

const historicoSchema = z.object({
  id: z.uuid(),
  origem: z.enum(ORIGENS),
  de_etapa_id: z.uuid().nullable(),
  para_etapa_id: z.uuid().nullable(),
  por: z.uuid().nullable(),
  em: z.string(),
  desfeito_em: z.string().nullable(),
  etapa_sinais: z.union([z.object({ documentos: documentoEmbutido }), z.object({ documentos: documentoEmbutido }).array()]).nullable(),
});

async function nomesDasPessoas(sessao: Sessao, ids: readonly string[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  await Promise.all([...new Set(ids)].map(async (id) => {
    const { data, error } = await sessao.rpc("nome_pessoa", { p_profile: id });
    if (!error && typeof data === "string" && data !== "") nomes.set(id, limitarTexto(data, 80));
  }));
  return nomes;
}

async function historicoDoProjeto(projetoId: string, podeEditar: boolean, sessao: Sessao): Promise<MudancaDeEtapa[]> {
  const [projeto, etapas, historico] = await Promise.all([
    sessao.from("projetos").select("etapa_atual_id").eq("id", projetoId).maybeSingle(),
    sessao.from("projeto_etapas").select("id,nome").eq("projeto_id", projetoId).limit(200),
    // A ordem vem do banco (em, id): o desfazer do banco usa a mesma, e comparar o texto das datas aqui erraria.
    sessao.from("projeto_etapa_historico")
      .select("id,origem,de_etapa_id,para_etapa_id,por,em,desfeito_em,etapa_sinais(documentos(titulo))")
      .eq("projeto_id", projetoId).order("em", { ascending: false }).order("id", { ascending: false }).limit(LIMITE_DO_HISTORICO),
  ]);
  conferirErro(projeto.error);
  conferirErro(etapas.error);
  conferirErro(historico.error);
  const { etapa_atual_id: etapaAtualId } = ler(z.object({ etapa_atual_id: z.uuid().nullable() }), projeto.data ?? { etapa_atual_id: null });
  const nomesDasEtapas = new Map(ler(z.object({ id: z.uuid(), nome: z.string() }).array(), etapas.data as unknown).map((etapa) => [etapa.id, limitarTexto(etapa.nome)]));
  const linhas = ler(historicoSchema.array(), historico.data as unknown);
  const nomes = await nomesDasPessoas(sessao, linhas.flatMap((linha) => (linha.por ? [linha.por] : [])));

  // Só a última mudança vinda de arquivo e ainda valendo se desfaz (o banco repete todas estas conferências).
  const ultima = linhas.find((linha) => linha.desfeito_em === null && linha.origem !== "desfazer");
  return linhas.map((linha) => ({
    id: linha.id,
    origem: linha.origem,
    deEtapaNome: linha.de_etapa_id ? nomesDasEtapas.get(linha.de_etapa_id) ?? null : null,
    paraEtapaNome: linha.para_etapa_id ? nomesDasEtapas.get(linha.para_etapa_id) ?? null : null,
    arquivo: tituloDoDocumento(umOuLista(linha.etapa_sinais)?.documentos ?? null),
    porNome: linha.por ? nomes.get(linha.por) ?? null : null,
    em: linha.em,
    desfeita: linha.desfeito_em !== null,
    podeDesfazer: podeEditar && linha === ultima && ORIGENS_QUE_SE_DESFAZEM.includes(linha.origem)
      && linha.de_etapa_id !== null && linha.para_etapa_id !== null && linha.para_etapa_id === etapaAtualId,
  }));
}

// Página do projeto: modo do empreendimento, a sugestão de agora (só com o modo ligado) e o histórico.
export async function etapasDoProjeto(projetoId: string, empreendimentoId: string, podeEditar: boolean): Promise<EtapasDoProjeto> {
  const sessao = await createClient();
  const modo = await modoDeEtapas(empreendimentoId, sessao);
  const [sugestao, historico] = await Promise.all([
    modo === "desligado" ? null : sugestaoDoProjeto(projetoId, sessao),
    historicoDoProjeto(projetoId, podeEditar, sessao),
  ]);
  return { modo, sugestao, historico };
}

// Só o administrador liga ou desliga o automático (o gatilho do banco recusa os demais; a mensagem clara vem daqui).
export async function definirModo({ empreendimentoId, modo }: ModoInput, ehAdmin: boolean): Promise<{ modo: ModoDeEtapas }> {
  const sessao = await createClient();
  const atual = await modoDeEtapas(empreendimentoId, sessao);
  if (atual === modo) return { modo };
  if (!ehAdmin && (modo === "automatico" || atual === "automatico")) throw new ForbiddenError(MENSAGEM_SO_ADMIN);
  const { data, error } = await sessao.from("empreendimentos").update({ etapas_modo: modo }).eq("id", empreendimentoId).select("etapas_modo").maybeSingle();
  if (z.object({ code: z.string() }).safeParse(error).data?.code === "42501") throw new ForbiddenError(MENSAGEM_SO_ADMIN);
  conferirErro(error);
  if (!data) throw new NotFoundError("Empreendimento não encontrado.");
  return { modo: ler(z.object({ etapas_modo: z.enum(MODOS_DE_ETAPAS) }), data as unknown).etapas_modo };
}

export async function confirmarSugestao({ projetoId, sinalId }: ConfirmarInput): Promise<{ historicoId: string }> {
  const sessao = await createClient();
  const { data, error } = await sessao.rpc("aplicar_sugestao_etapa", { p_projeto: projetoId, p_sinal: sinalId, p_origem: "sugestao" });
  tratarErro(error);
  return { historicoId: ler(z.uuid(), data as unknown) };
}

export async function ignorarSinal({ sinalId }: IgnorarInput): Promise<{ sinalId: string }> {
  const sessao = await createClient();
  const { error } = await sessao.rpc("ignorar_sinal_etapa", { p_sinal: sinalId });
  tratarErro(error);
  return { sinalId };
}

export async function desfazerMudanca({ historicoId }: DesfazerInput): Promise<{ historicoId: string }> {
  const sessao = await createClient();
  const { error } = await sessao.rpc("desfazer_etapa", { p_historico: historicoId });
  tratarErro(error);
  return { historicoId };
}

// Todas as sugestões atuais do empreendimento (uma por projeto: o estado final, não uma por arquivo).
export async function sugestoesDoEmpreendimento({ empreendimentoId }: RecalculoConsultaInput): Promise<SugestaoDoRecalculo[]> {
  const sessao = await createClient();
  if (await modoDeEtapas(empreendimentoId, sessao) === "desligado") return [];

  const { data, error } = await sessao.from("projetos").select("id,nome,etapa_atual_id")
    .eq("empreendimento_id", empreendimentoId).order("ordem").order("nome").order("id").limit(LIMITE_DE_PROJETOS);
  conferirErro(error);
  const projetos = ler(z.object({ id: z.uuid(), nome: z.string(), etapa_atual_id: z.uuid().nullable() }).array(), data as unknown);

  const atuais = projetos.flatMap((projeto) => (projeto.etapa_atual_id ? [projeto.etapa_atual_id] : []));
  const nomesDasEtapas = new Map<string, string>();
  if (atuais.length > 0) {
    const { data: etapas, error: erroEtapas } = await sessao.from("projeto_etapas").select("id,nome").in("id", atuais).limit(LIMITE_DE_PROJETOS);
    conferirErro(erroEtapas);
    for (const etapa of ler(z.object({ id: z.uuid(), nome: z.string() }).array(), etapas as unknown)) nomesDasEtapas.set(etapa.id, limitarTexto(etapa.nome));
  }

  const sugestoes = await sugestoesDosProjetos(projetos.map((projeto) => projeto.id), sessao);
  return projetos.flatMap((projeto): SugestaoDoRecalculo[] => {
    const sugestao = sugestoes.get(projeto.id);
    if (!sugestao) return [];
    return [{
      projetoId: projeto.id,
      sinalId: sugestao.sinalId,
      projetoNome: limitarTexto(projeto.nome),
      deEtapaNome: projeto.etapa_atual_id ? nomesDasEtapas.get(projeto.etapa_atual_id) ?? null : null,
      paraEtapaNome: sugestao.etapaNome,
      dataArquivo: sugestao.dataArquivo,
      arquivo: sugestao.arquivo,
    }];
  });
}

// Tudo ou nada no banco; devolve quantos projetos mudaram (sugestão que deixou de valer entre a tela e o clique fica de fora).
export async function aplicarSugestoes({ empreendimentoId, itens }: RecalculoAplicarInput): Promise<{ aplicadas: number }> {
  const sessao = await createClient();
  const { data, error } = await sessao.rpc("aplicar_sugestoes_empreendimento", {
    p_empreendimento: empreendimentoId,
    p_projetos: itens.map((item) => item.projetoId),
    p_sinais: itens.map((item) => item.sinalId),
  });
  tratarErro(error);
  return { aplicadas: ler(z.number().int(), data as unknown) };
}
