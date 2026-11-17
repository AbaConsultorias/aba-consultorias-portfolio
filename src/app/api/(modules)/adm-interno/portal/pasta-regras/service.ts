import "server-only";
import z from "zod";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/app/api/HttpErrors";
import { regrasOrfasDaArvore } from "@/lib/conector/montagem";
import { chaveDoCaminho } from "@/lib/conector/regras";
import { GRUPOS_DE_DOCUMENTO, pastasDaArvore } from "@/lib/conector/sugestoes";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";
import { MODOS_DE_ETAPAS, type ArvoreDaPasta, type DadosDaPasta, type ModoDeEtapas, type ProjetoDaPasta, type RegraDePasta, type SinalDaRegra } from "@/lib/portal/pasta/tipos";
import { createClient } from "@/lib/supabase/server";
import { destinoValido, mensagemDoDestino, TIPOS_DE_REGRA, TIPOS_QUE_MARCAM_ETAPA, type AtualizarInput, type ConsultaInput, type CriarInput, type ExcluirInput, type TipoDeRegra } from "./schema";

type Sessao = Awaited<ReturnType<typeof createClient>>;
type Destino = { projeto_id: string | null; categoria_id: string | null; grupo: (typeof GRUPOS_DE_DOCUMENTO)[number] | null; rotulo: string | null };

const COLUNAS_DA_REGRA = "id,empreendimento_id,caminho_prefixo,tipo,sinal,projeto_id,categoria_id,grupo,rotulo,liberar_automatico,ativa";
const MENSAGEM_SEM_CATEGORIAS_DE_EQUIPAMENTO = "O projeto precisa ter as categorias SIMOS e Laudos.";
const MENSAGEM_SEM_ETAPA_APROVADO = "O projeto não tem uma etapa marcada como Aprovado. Marque a etapa na tela Modelos.";
const MENSAGEM_SO_OCULTA = "Protocolos e devolutivas ficam ocultos: não têm liberação automática.";
const MENSAGEM_ARQUIVO_OCULTO = "Os PDFs de Outros projetos ficam ocultos até a equipe liberar: não têm liberação automática.";
const SINAIS = ["protocolo", "devolutiva", "aprovado"] as const;
const LIMITE_DE_REGRAS = 1000;
const LIMITE_DE_PROJETOS = 200;
const CODIGO_DUPLICADO = "23505";
const MENSAGEM_REGRA_DUPLICADA = "Já existe uma regra para esta pasta neste empreendimento.";
const MENSAGEM_SO_ADMIN = "Acesso negado.";

const linhaSchema = z.object({
  id: z.uuid(),
  empreendimento_id: z.uuid(),
  caminho_prefixo: z.string(),
  tipo: z.enum(TIPOS_DE_REGRA).default("comum"),
  sinal: z.enum(SINAIS).nullable(),
  projeto_id: z.uuid().nullable(),
  categoria_id: z.uuid().nullable(),
  grupo: z.enum(GRUPOS_DE_DOCUMENTO).nullable(),
  rotulo: z.string().nullable(),
  liberar_automatico: z.boolean(),
  ativa: z.boolean(),
});

const nomeDoModelo = z.object({ nome: z.string() });
const projetoSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  modelos_etapas: z.union([nomeDoModelo, nomeDoModelo.array()]).nullable(),
  projeto_categorias_documento: z.object({ id: z.uuid(), nome: z.string(), ordem: z.number() }).array(),
});

function paraRegra(linha: z.infer<typeof linhaSchema>): RegraDePasta {
  return {
    id: linha.id,
    empreendimentoId: linha.empreendimento_id,
    caminhoPrefixo: linha.caminho_prefixo,
    tipo: linha.tipo,
    sinal: linha.sinal,
    projetoId: linha.projeto_id,
    categoriaId: linha.categoria_id,
    grupo: linha.grupo,
    rotulo: linha.rotulo,
    liberarAutomatico: linha.liberar_automatico,
    ativa: linha.ativa,
  };
}

function ehDuplicidade(error: unknown): boolean {
  const erro = z.object({ code: z.string() }).safeParse(error);
  return erro.success && erro.data.code === CODIGO_DUPLICADO;
}

export async function listar({ empreendimentoId }: ConsultaInput, sessao?: Sessao): Promise<RegraDePasta[]> {
  const cliente = sessao ?? await createClient();
  const { data, error } = await cliente.from("pasta_regras").select(COLUNAS_DA_REGRA)
    .eq("empreendimento_id", empreendimentoId).order("caminho_prefixo").order("id").limit(LIMITE_DE_REGRAS);
  conferirErro(error);
  return ler(linhaSchema.array(), data as unknown).map(paraRegra);
}

export async function projetosDoEmpreendimento({ empreendimentoId }: ConsultaInput, sessao?: Sessao): Promise<ProjetoDaPasta[]> {
  const cliente = sessao ?? await createClient();
  const { data, error } = await cliente.from("projetos")
    .select("id,nome,modelos_etapas(nome),projeto_categorias_documento(id,nome,ordem)")
    .eq("empreendimento_id", empreendimentoId).order("ordem").order("nome").order("id").limit(LIMITE_DE_PROJETOS);
  conferirErro(error);
  return ler(projetoSchema.array(), data as unknown).map((projeto) => {
    const modelo = Array.isArray(projeto.modelos_etapas) ? projeto.modelos_etapas[0] : projeto.modelos_etapas;
    return {
      id: projeto.id,
      nome: projeto.nome,
      modeloNome: modelo?.nome ?? null,
      categorias: [...projeto.projeto_categorias_documento].sort((a, b) => a.ordem - b.ordem).map(({ id, nome }) => ({ id, nome })),
    };
  });
}

// Só a coluna arvore do conector ativo: token_hash não é legível por usuário logado e nunca é pedido.
export async function arvoreDoCodigo(codigoPasta: string | null, sessao?: Sessao): Promise<ArvoreDaPasta> {
  if (!codigoPasta) return { situacao: "sem-codigo" };
  const cliente = sessao ?? await createClient();
  const { data, error } = await cliente.from("conectores").select("arvore,ultimo_contato_em").is("revogado_em", null).maybeSingle();
  conferirErro(error);
  const linha = ler(z.object({ arvore: z.unknown(), ultimo_contato_em: z.string().nullable() }).nullable(), data as unknown);
  const pastas = linha ? pastasDaArvore(linha.arvore, codigoPasta) : [];
  if (!linha || pastas.length === 0) return { situacao: "sem-arvore" };
  return { situacao: "ok", pastas, atualizadoEm: linha.ultimo_contato_em };
}

export async function arvoreDoEmpreendimento({ empreendimentoId }: ConsultaInput, sessao?: Sessao): Promise<ArvoreDaPasta> {
  const cliente = sessao ?? await createClient();
  const { data, error } = await cliente.from("empreendimentos").select("codigo_pasta").eq("id", empreendimentoId).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Empreendimento não encontrado.");
  const { codigo_pasta } = ler(z.object({ codigo_pasta: z.string().nullable() }), data as unknown);
  return arvoreDoCodigo(codigo_pasta, cliente);
}

export type EmpreendimentoComRegrasOrfas = { id: string; nome: string; quantidade: number };
export type AvisoDeRegrasOrfas = { total: number; empreendimentos: EmpreendimentoComRegrasOrfas[] };

const LIMITE_DE_EMPREENDIMENTOS = 500;
const LIMITE_DE_REGRAS_NO_PAINEL = 5000;

// Painel do portal: regras ativas cuja pasta não está mais na árvore do conector. Só conta empreendimentos cuja árvore o
// programa já informou (sem árvore não dá para saber). Quem não lê empreendimentos pelo RLS recebe a lista vazia.
export async function avisoDeRegrasOrfas(sessao?: Sessao): Promise<AvisoDeRegrasOrfas> {
  const cliente = sessao ?? await createClient();
  const [conector, empreendimentos, regras] = await Promise.all([
    cliente.from("conectores").select("arvore").is("revogado_em", null).maybeSingle(),
    cliente.from("empreendimentos").select("id,nome,codigo_pasta").not("codigo_pasta", "is", null).order("nome").order("id").limit(LIMITE_DE_EMPREENDIMENTOS),
    cliente.from("pasta_regras").select("id,empreendimento_id,caminho_prefixo,ativa").eq("ativa", true).limit(LIMITE_DE_REGRAS_NO_PAINEL),
  ]);
  conferirErro(conector.error);
  conferirErro(empreendimentos.error);
  conferirErro(regras.error);
  const arvore = ler(z.object({ arvore: z.unknown() }).nullable(), conector.data as unknown)?.arvore;
  if (!arvore) return { total: 0, empreendimentos: [] };

  const regrasPorEmpreendimento = new Map<string, { id: string; caminhoPrefixo: string; ativa: boolean }[]>();
  for (const regra of ler(z.object({ id: z.uuid(), empreendimento_id: z.uuid(), caminho_prefixo: z.string(), ativa: z.boolean() }).array(), regras.data as unknown)) {
    const lista = regrasPorEmpreendimento.get(regra.empreendimento_id) ?? [];
    lista.push({ id: regra.id, caminhoPrefixo: regra.caminho_prefixo, ativa: regra.ativa });
    regrasPorEmpreendimento.set(regra.empreendimento_id, lista);
  }

  const afetados: EmpreendimentoComRegrasOrfas[] = [];
  for (const empreendimento of ler(z.object({ id: z.uuid(), nome: z.string(), codigo_pasta: z.string() }).array(), empreendimentos.data as unknown)) {
    const pastas = pastasDaArvore(arvore, empreendimento.codigo_pasta);
    const regrasDele = regrasPorEmpreendimento.get(empreendimento.id) ?? [];
    if (pastas.length === 0 || regrasDele.length === 0) continue;
    const quantidade = regrasOrfasDaArvore(pastas, regrasDele).length;
    if (quantidade > 0) afetados.push({ id: empreendimento.id, nome: empreendimento.nome, quantidade });
  }
  return { total: afetados.reduce((soma, item) => soma + item.quantidade, 0), empreendimentos: afetados };
}

async function liberacaoGeral(sessao: Sessao): Promise<boolean | null> {
  const { data, error } = await sessao.from("configuracoes_conector").select("liberacao_automatica_geral").maybeSingle();
  if (error) return null;
  const linha = z.object({ liberacao_automatica_geral: z.boolean() }).safeParse(data);
  return linha.success ? linha.data.liberacao_automatica_geral : null;
}

export async function modoDeEtapas(empreendimentoId: string, sessao?: Sessao): Promise<ModoDeEtapas> {
  const cliente = sessao ?? await createClient();
  const { data, error } = await cliente.from("empreendimentos").select("etapas_modo").eq("id", empreendimentoId).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Empreendimento não encontrado.");
  return ler(z.object({ etapas_modo: z.enum(MODOS_DE_ETAPAS) }), data as unknown).etapas_modo;
}

export async function carregarPasta(empreendimentoId: string, codigoPasta: string | null): Promise<DadosDaPasta> {
  const sessao = await createClient();
  const consulta = { empreendimentoId };
  const [regras, projetos, arvore, geral, etapasModo] = await Promise.all([
    listar(consulta, sessao), projetosDoEmpreendimento(consulta, sessao), arvoreDoCodigo(codigoPasta, sessao), liberacaoGeral(sessao),
    modoDeEtapas(empreendimentoId, sessao),
  ]);
  return { etapasModo, regras, projetos, arvore, liberacaoGeral: geral };
}

async function conferirEmpreendimento(sessao: Sessao, empreendimentoId: string): Promise<void> {
  const { data, error } = await sessao.from("empreendimentos").select("id").eq("id", empreendimentoId).maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Empreendimento não encontrado.");
}

// O trigger validar_pasta_regra também confere, mas devolve um erro genérico: aqui a pessoa recebe a causa.
async function conferirDestino(sessao: Sessao, empreendimentoId: string, destino: Destino): Promise<void> {
  if (!destino.projeto_id) return;
  const { data: projeto, error: erroProjeto } = await sessao.from("projetos").select("id")
    .eq("id", destino.projeto_id).eq("empreendimento_id", empreendimentoId).maybeSingle();
  conferirErro(erroProjeto);
  if (!projeto) throw new ConflictError("O projeto precisa ser deste empreendimento.");
  if (!destino.categoria_id) return;
  const { data: categoria, error: erroCategoria } = await sessao.from("projeto_categorias_documento").select("id")
    .eq("id", destino.categoria_id).eq("projeto_id", destino.projeto_id).maybeSingle();
  conferirErro(erroCategoria);
  if (!categoria) throw new ConflictError("A categoria precisa ser do projeto escolhido.");
}

// A regra de equipamentos manda o SIMO para a categoria "SIMOS" e o Laudo para "Laudos" do projeto: sem as duas, o
// conector recusaria tudo. O trigger validar_pasta_regra confere de novo (sem diferenciar caixa), mas só devolve erro genérico.
async function conferirCategoriasDeEquipamento(sessao: Sessao, projetoId: string): Promise<void> {
  const { data, error } = await sessao.from("projeto_categorias_documento").select("nome").eq("projeto_id", projetoId).limit(1000);
  conferirErro(error);
  const nomes = new Set(ler(z.object({ nome: z.string() }).array(), data as unknown).map(({ nome }) => nome.trim().toLowerCase()));
  if (!nomes.has("simos") || !nomes.has("laudos")) throw new ConflictError(MENSAGEM_SEM_CATEGORIAS_DE_EQUIPAMENTO);
}

// O Windows não diferencia maiúsculas de minúsculas, mas o único do banco diferencia: a comparação é feita aqui.
async function conferirPastaLivre(sessao: Sessao, empreendimentoId: string, caminhoPrefixo: string, ignorarId: string | null): Promise<void> {
  const { data, error } = await sessao.from("pasta_regras").select("id,caminho_prefixo").eq("empreendimento_id", empreendimentoId).limit(LIMITE_DE_REGRAS);
  conferirErro(error);
  const chave = chaveDoCaminho(caminhoPrefixo);
  const existentes = ler(z.object({ id: z.uuid(), caminho_prefixo: z.string() }).array(), data as unknown);
  if (existentes.some((regra) => regra.id !== ignorarId && chaveDoCaminho(regra.caminho_prefixo) === chave)) throw new ConflictError(MENSAGEM_REGRA_DUPLICADA);
}

// protocolos <=> protocolo e devolutivas <=> devolutiva (pasta_regras_sinal_check); comum só pode ter "aprovado".
const SINAL_DO_TIPO: Partial<Record<TipoDeRegra, SinalDaRegra>> = { protocolos: "protocolo", devolutivas: "devolutiva" };

// A marca Aprovado só adianta se o projeto tem a etapa de marco "aprovado": sem ela, a sugestão nunca apareceria.
async function conferirEtapaAprovado(sessao: Sessao, projetoId: string): Promise<void> {
  const { data, error } = await sessao.from("projeto_etapas").select("id").eq("projeto_id", projetoId).eq("marco", "aprovado").limit(1);
  conferirErro(error);
  if (!data || data.length === 0) throw new ConflictError(MENSAGEM_SEM_ETAPA_APROVADO);
}

export async function criar(entrada: CriarInput, ehAdmin: boolean): Promise<{ id: string }> {
  if (entrada.liberarAutomatico && !ehAdmin) throw new ForbiddenError(MENSAGEM_SO_ADMIN);
  const sessao = await createClient();
  const destino: Destino = { projeto_id: entrada.projetoId ?? null, categoria_id: entrada.categoriaId ?? null, grupo: entrada.grupo ?? null, rotulo: entrada.rotulo ?? null };
  await conferirEmpreendimento(sessao, entrada.empreendimentoId);
  await conferirDestino(sessao, entrada.empreendimentoId, destino);
  if (entrada.tipo === "equipamentos" && destino.projeto_id) await conferirCategoriasDeEquipamento(sessao, destino.projeto_id);
  if (entrada.marcaAprovado === true && destino.projeto_id) await conferirEtapaAprovado(sessao, destino.projeto_id);
  await conferirPastaLivre(sessao, entrada.empreendimentoId, entrada.caminhoPrefixo, null);
  const { data, error } = await sessao.from("pasta_regras").insert({
    empreendimento_id: entrada.empreendimentoId,
    caminho_prefixo: entrada.caminhoPrefixo,
    tipo: entrada.tipo,
    sinal: SINAL_DO_TIPO[entrada.tipo] ?? (entrada.marcaAprovado === true ? "aprovado" : null),
    ...destino,
    liberar_automatico: entrada.liberarAutomatico,
    ativa: entrada.ativa,
  }).select("id,sinal").single();
  if (ehDuplicidade(error)) throw new ConflictError(MENSAGEM_REGRA_DUPLICADA);
  conferirErro(error);
  const criada = ler(z.object({ id: z.uuid(), sinal: z.enum(SINAIS).nullable() }), data as unknown);

  // Sem sinal informado o gatilho do banco marca sozinho a pasta APROVADO; quem desmarcou na tela quer a regra sem marca.
  if (entrada.marcaAprovado === false && criada.sinal === "aprovado") {
    const { error: erroSinal } = await sessao.from("pasta_regras").update({ sinal: null }).eq("id", criada.id);
    conferirErro(erroSinal);
  }
  return { id: criada.id };
}

// Regra com liberação automática ligada publica sozinha para o cliente: mexer no destino ou na pasta dela muda o que é publicado.
const estadoDaRegraSchema = z.object({
  empreendimento_id: z.uuid(),
  liberar_automatico: z.boolean(),
  tipo: z.enum(TIPOS_DE_REGRA).default("comum"),
  sinal: z.enum(SINAIS).nullable(),
  projeto_id: z.uuid().nullable(),
  grupo: z.enum(GRUPOS_DE_DOCUMENTO).nullable(),
});

export async function atualizar(entrada: AtualizarInput, ehAdmin: boolean): Promise<{ id: string }> {
  const sessao = await createClient();
  const { data: atual, error: erroAtual } = await sessao.from("pasta_regras").select("id,empreendimento_id,liberar_automatico,tipo,sinal,projeto_id,grupo").eq("id", entrada.id).maybeSingle();
  conferirErro(erroAtual);
  if (!atual) throw new NotFoundError("Regra não encontrada.");
  const { empreendimento_id: empreendimentoId, liberar_automatico: ligadaHoje, tipo: tipoHoje, sinal: sinalHoje, projeto_id: projetoHoje, grupo: grupoHoje } = ler(estadoDaRegraSchema, atual as unknown);
  const mudaInterruptor = entrada.liberarAutomatico !== undefined && entrada.liberarAutomatico !== ligadaHoje;
  if (!ehAdmin && (ligadaHoje || mudaInterruptor)) throw new ForbiddenError(MENSAGEM_SO_ADMIN);

  const tipo: TipoDeRegra = entrada.tipo ?? tipoHoje;
  if (TIPOS_QUE_MARCAM_ETAPA.includes(tipo) && (entrada.liberarAutomatico ?? ligadaHoje)) throw new ConflictError(MENSAGEM_SO_OCULTA);

  const mudaDestino = entrada.projetoId !== undefined || entrada.categoriaId !== undefined || entrada.grupo !== undefined || entrada.rotulo !== undefined;
  const grupoFinal = mudaDestino ? entrada.grupo ?? null : grupoHoje;
  if (grupoFinal === "arquivo" && (entrada.liberarAutomatico ?? ligadaHoje)) throw new ConflictError(MENSAGEM_ARQUIVO_OCULTO);

  const campos: Record<string, unknown> = {};
  if (entrada.caminhoPrefixo !== undefined) {
    await conferirPastaLivre(sessao, empreendimentoId, entrada.caminhoPrefixo, entrada.id);
    campos.caminho_prefixo = entrada.caminhoPrefixo;
  }
  if (mudaDestino) {
    const destino: Destino = { projeto_id: entrada.projetoId ?? null, categoria_id: entrada.categoriaId ?? null, grupo: entrada.grupo ?? null, rotulo: entrada.rotulo ?? null };
    if (!destinoValido({ projetoId: destino.projeto_id, categoriaId: destino.categoria_id, grupo: destino.grupo, rotulo: destino.rotulo }, tipo)) {
      throw new BadRequestError(mensagemDoDestino(tipo));
    }
    await conferirDestino(sessao, empreendimentoId, destino);
    if (tipo === "equipamentos" && destino.projeto_id) await conferirCategoriasDeEquipamento(sessao, destino.projeto_id);
    Object.assign(campos, destino);
    if (entrada.tipo !== undefined) campos.tipo = entrada.tipo;
  }

  // O sinal acompanha o tipo (protocolos/devolutivas têm o seu); na regra comum só existe "aprovado" e só com projeto.
  const projetoFinal = mudaDestino ? entrada.projetoId ?? null : projetoHoje;
  let sinalFinal: SinalDaRegra | null = SINAL_DO_TIPO[tipo] ?? null;
  if (tipo === "comum") {
    if (entrada.marcaAprovado === true && !projetoFinal) throw new BadRequestError(mensagemDoDestino("comum"));
    const marcada = entrada.marcaAprovado ?? sinalHoje === "aprovado";
    sinalFinal = marcada && projetoFinal ? "aprovado" : null;
  } else if (entrada.marcaAprovado === true) {
    throw new BadRequestError("A marca Aprovado vale só para regra comum de um projeto.");
  }
  if (sinalFinal !== sinalHoje) {
    if (sinalFinal === "aprovado" && projetoFinal) await conferirEtapaAprovado(sessao, projetoFinal);
    campos.sinal = sinalFinal;
  }
  if (entrada.liberarAutomatico !== undefined) campos.liberar_automatico = entrada.liberarAutomatico;
  if (entrada.ativa !== undefined) campos.ativa = entrada.ativa;

  const { data, error } = await sessao.from("pasta_regras").update(campos).eq("id", entrada.id).select("id").maybeSingle();
  if (ehDuplicidade(error)) throw new ConflictError(MENSAGEM_REGRA_DUPLICADA);
  conferirErro(error);
  if (!data) throw new NotFoundError("Regra não encontrada.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}

export async function excluir({ id }: ExcluirInput, ehAdmin: boolean): Promise<{ id: string }> {
  const sessao = await createClient();
  const { data: atual, error: erroAtual } = await sessao.from("pasta_regras").select("liberar_automatico").eq("id", id).maybeSingle();
  conferirErro(erroAtual);
  if (!atual) throw new NotFoundError("Regra não encontrada.");
  const { liberar_automatico: ligada } = ler(z.object({ liberar_automatico: z.boolean() }), atual as unknown);
  if (ligada && !ehAdmin) throw new ForbiddenError(MENSAGEM_SO_ADMIN);
  const { data, error } = await sessao.from("pasta_regras").delete().eq("id", id).select("id").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Regra não encontrada.");
  return { id };
}
