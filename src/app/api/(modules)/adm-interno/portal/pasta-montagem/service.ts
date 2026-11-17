import "server-only";
import z from "zod";
import { ConflictError, ForbiddenError, NotFoundError } from "@/app/api/HttpErrors";
import { montarPrevia, prontoParaComplementares, resolverSelecao, type ProjetoParaMontagem, type RegraDerivadaSelecionada, type TipoDeRegraDerivada } from "@/lib/conector/montagem";
import type { Permissao } from "@/lib/auth/permissoes";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";
import type { PreviaDaMontagem, ResumoDaMontagem } from "@/lib/portal/pasta/tipos";
import { createClient } from "@/lib/supabase/server";
import { listarCatalogo } from "../catalogo-pastas/service";
import { arvoreDoCodigo, criar as criarRegra } from "../pasta-regras/service";
import type { ComplementaresInput, ConsultaInput, MontarInput } from "./schema";

type Sessao = Awaited<ReturnType<typeof createClient>>;

const LIMITE_DE_PROJETOS = 200;
const LIMITE_DE_REGRAS = 1000;
const CODIGO_DE_REGRA_DE_NEGOCIO = "P0001";

const empreendimentoSchema = z.object({ codigo_pasta: z.string().nullable(), ler_complementares: z.boolean() });
const projetoSchema = z.object({ id: z.uuid(), nome: z.string(), modelo_origem_id: z.uuid().nullable() });
const regraSchema = z.object({ id: z.uuid(), caminho_prefixo: z.string(), ativa: z.boolean() });
const resumoSchema = z.object({
  projetos_criados: z.number().int(),
  projetos_reaproveitados: z.number().int(),
  regras_criadas: z.number().int(),
  ignorados: z.object({ chave: z.string(), caminho: z.string(), motivo: z.string() }).array(),
});

async function lerEmpreendimento(sessao: Sessao, empreendimentoId: string) {
  const { data, error } = await sessao.from("empreendimentos").select("codigo_pasta,ler_complementares").eq("id", empreendimentoId).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Empreendimento não encontrado.");
  return ler(empreendimentoSchema, data as unknown);
}

// Só lê: calcula o que a montagem faria hoje com a árvore, o catálogo, os projetos e as regras do empreendimento.
export async function previaDaMontagem({ empreendimentoId }: ConsultaInput, sessao?: Sessao): Promise<PreviaDaMontagem> {
  const cliente = sessao ?? await createClient();
  const empreendimento = await lerEmpreendimento(cliente, empreendimentoId);
  const arvore = await arvoreDoCodigo(empreendimento.codigo_pasta, cliente);
  if (arvore.situacao !== "ok") return { situacao: arvore.situacao };

  const [catalogo, projetos, regras] = await Promise.all([
    listarCatalogo(cliente),
    cliente.from("projetos").select("id,nome,modelo_origem_id").eq("empreendimento_id", empreendimentoId).limit(LIMITE_DE_PROJETOS),
    cliente.from("pasta_regras").select("id,caminho_prefixo,ativa").eq("empreendimento_id", empreendimentoId).limit(LIMITE_DE_REGRAS),
  ]);
  conferirErro(projetos.error);
  conferirErro(regras.error);

  const montagem = montarPrevia({
    pastas: arvore.pastas,
    catalogo,
    projetos: ler(projetoSchema.array(), projetos.data as unknown).map((projeto) => ({ id: projeto.id, nome: projeto.nome, modeloId: projeto.modelo_origem_id })),
    regras: ler(regraSchema.array(), regras.data as unknown).map((regra) => ({ id: regra.id, caminhoPrefixo: regra.caminho_prefixo, ativa: regra.ativa })),
    lerComplementares: empreendimento.ler_complementares,
  });
  return { situacao: "ok", montagem, atualizadoEm: arvore.atualizadoEm };
}

// O banco confere de novo (permissões, caminhos na árvore, catálogo, fase); a mensagem de uma regra de negócio é nossa.
function tratarErroDaMontagem(error: unknown): void {
  const erro = z.object({ code: z.string().optional(), message: z.string().optional() }).safeParse(error);
  if (erro.success && erro.data.code === CODIGO_DE_REGRA_DE_NEGOCIO && erro.data.message) throw new ConflictError(erro.data.message.slice(0, 300));
  conferirErro(error);
}

// A pessoa precisa de empreendimentos.editar (conferida na rota) e de servidor.regras (aqui e no banco). O corpo só
// escolhe entre as candidatas: tudo é recalculado e o que sobra dos itens vai para a função do banco.
export async function montar(entrada: MontarInput, permissoes: ReadonlySet<Permissao>): Promise<ResumoDaMontagem> {
  if (!permissoes.has("servidor.regras")) throw new ForbiddenError("Acesso negado.");
  const sessao = await createClient();
  const previa = await previaDaMontagem({ empreendimentoId: entrada.empreendimentoId }, sessao);
  if (previa.situacao !== "ok") throw new ConflictError("O programa do servidor ainda não informou as pastas deste empreendimento.");

  const selecao = resolverSelecao(previa.montagem, entrada.itens.map((item) => ({ chave: item.chave, sistema: item.sistema ?? null, caminhos: item.caminhos })));
  if (!selecao.ok) throw new ConflictError(selecao.erro);

  const { data, error } = await sessao.rpc("montar_empreendimento_de_pastas", { p_empreendimento: entrada.empreendimentoId, p_itens: selecao.itens });
  tratarErroDaMontagem(error);
  const resumo = ler(resumoSchema, data as unknown);
  // A função do banco só cria regra comum e de equipamentos: protocolos e devolutivas vêm logo depois, pelo mesmo serviço
  // de regras de pasta, já com os projetos no banco. Se alguma falhar, as demais (já gravadas) continuam valendo.
  const etapas = await criarRegrasDeEtapa(sessao, entrada.empreendimentoId, selecao.derivadas);
  return {
    projetosCriados: resumo.projetos_criados,
    projetosReaproveitados: resumo.projetos_reaproveitados,
    regrasCriadas: resumo.regras_criadas,
    regrasDeEtapaCriadas: etapas.criadas,
    regrasDeEtapaPuladas: etapas.puladas,
    ignorados: resumo.ignorados,
  };
}

const NOME_DA_CATEGORIA: Record<TipoDeRegraDerivada, string> = { protocolos: "Protocolos", devolutivas: "Devolutivas da Copasa" };
const comparavel = (nome: string): string => nome.trim().toLowerCase();

// Categoria do projeto com este nome; se não existe, cria no fim da lista (insert direto, pelo RLS de quem montou). Os
// documentos de protocolo e de LAN chegam ocultos nelas. Falhou? A regra nasce sem categoria, em vez de nenhuma regra.
async function categoriaDoProjeto(sessao: Sessao, projetoId: string, nome: string): Promise<string | null> {
  try {
    const { data, error } = await sessao.from("projeto_categorias_documento").select("id,nome,ordem").eq("projeto_id", projetoId).limit(1000);
    conferirErro(error);
    const categorias = ler(z.object({ id: z.uuid(), nome: z.string(), ordem: z.number().int() }).array(), data as unknown);
    const existente = categorias.find((categoria) => comparavel(categoria.nome) === comparavel(nome));
    if (existente) return existente.id;
    const ordem = categorias.reduce((maior, categoria) => Math.max(maior, categoria.ordem), -1) + 1;
    const { data: criada, error: erroCriar } = await sessao.from("projeto_categorias_documento").insert({ projeto_id: projetoId, nome, ordem }).select("id").single();
    conferirErro(erroCriar);
    return ler(z.object({ id: z.uuid() }), criada as unknown).id;
  } catch {
    console.error("[montagem] categoria de etapa não criada");
    return null;
  }
}

async function criarRegrasDeEtapa(sessao: Sessao, empreendimentoId: string, derivadas: readonly RegraDerivadaSelecionada[]): Promise<{ criadas: number; puladas: number }> {
  if (derivadas.length === 0) return { criadas: 0, puladas: 0 };
  const nomes = [...new Set(derivadas.map((regra) => regra.nomeProjeto))];
  const { data, error } = await sessao.from("projetos").select("id,nome").eq("empreendimento_id", empreendimentoId).in("nome", nomes).limit(LIMITE_DE_PROJETOS);
  conferirErro(error);
  const projetos = ler(z.object({ id: z.uuid(), nome: z.string() }).array(), data as unknown);
  // Nome repetido no empreendimento: não dá para saber de qual projeto é, então a regra não é criada.
  const idsPorNome = new Map<string, string[]>();
  for (const projeto of projetos) idsPorNome.set(projeto.nome, [...idsPorNome.get(projeto.nome) ?? [], projeto.id]);

  let criadas = 0;
  let puladas = 0;
  for (const regra of derivadas) {
    const ids = idsPorNome.get(regra.nomeProjeto) ?? [];
    if (ids.length !== 1) {
      puladas += 1;
      continue;
    }
    const categoriaId = await categoriaDoProjeto(sessao, ids[0], NOME_DA_CATEGORIA[regra.tipo]);
    try {
      await criarRegra({
        empreendimentoId, caminhoPrefixo: regra.caminho, tipo: regra.tipo, projetoId: ids[0], categoriaId, grupo: null, rotulo: null, liberarAutomatico: false, ativa: true,
      }, false);
      criadas += 1;
    } catch (erro) {
      if (!(erro instanceof ConflictError)) console.error("[montagem] regra de etapa não criada:", regra.tipo);
      puladas += 1;
    }
  }
  return { criadas, puladas };
}

// Ligar ou desligar "Ler projetos complementares": empreendimentos.editar (rota) + RLS; a auditoria da tabela registra.
export async function definirComplementares({ empreendimentoId, lerComplementares }: ComplementaresInput): Promise<{ lerComplementares: boolean }> {
  const sessao = await createClient();
  const { data, error } = await sessao.from("empreendimentos").update({ ler_complementares: lerComplementares }).eq("id", empreendimentoId).select("ler_complementares").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Empreendimento não encontrado.");
  return { lerComplementares: ler(z.object({ ler_complementares: z.boolean() }), data as unknown).ler_complementares };
}

// Estado da chave e aviso "pronto para ler os complementares" (SAA ou SES numa etapa que contém APROVAD).
export async function estadoDosComplementares(empreendimentoId: string): Promise<{ lerComplementares: boolean; pronto: boolean }> {
  const sessao = await createClient();
  const { ler_complementares: lerComplementares } = await lerEmpreendimento(sessao, empreendimentoId);
  if (lerComplementares) return { lerComplementares, pronto: false };

  const catalogo = await listarCatalogo(sessao);
  const modelos = catalogo.filter((item) => item.chave === "saa" || item.chave === "ses").flatMap((item) => (item.modeloId ? [item.modeloId] : []));
  if (modelos.length === 0) return { lerComplementares, pronto: false };

  const { data, error } = await sessao.from("projetos").select("id,nome,modelo_origem_id,etapa_atual_id")
    .eq("empreendimento_id", empreendimentoId).in("modelo_origem_id", modelos).limit(LIMITE_DE_PROJETOS);
  conferirErro(error);
  const projetos = ler(projetoSchema.extend({ etapa_atual_id: z.uuid().nullable() }).array(), data as unknown);
  const etapaIds = projetos.flatMap((projeto) => (projeto.etapa_atual_id ? [projeto.etapa_atual_id] : []));
  const nomesDasEtapas = new Map<string, string>();
  if (etapaIds.length > 0) {
    const { data: etapas, error: erroEtapas } = await sessao.from("projeto_etapas").select("id,nome").in("id", etapaIds).limit(LIMITE_DE_PROJETOS);
    conferirErro(erroEtapas);
    for (const etapa of ler(z.object({ id: z.uuid(), nome: z.string() }).array(), etapas as unknown)) nomesDasEtapas.set(etapa.id, etapa.nome);
  }
  const paraMontagem: ProjetoParaMontagem[] = projetos.map((projeto) => ({
    id: projeto.id, nome: projeto.nome, modeloId: projeto.modelo_origem_id,
    etapaAtualNome: projeto.etapa_atual_id ? nomesDasEtapas.get(projeto.etapa_atual_id) ?? null : null,
  }));
  return { lerComplementares, pronto: prontoParaComplementares(paraMontagem, catalogo) };
}
