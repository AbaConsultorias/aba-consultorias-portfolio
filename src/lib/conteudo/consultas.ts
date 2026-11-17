import "server-only";
import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  BannerHero,
  CategoriaProjeto,
  Configuracoes,
  Depoimento,
  FrenteServico,
  Loteamento,
  LoteamentoResumo,
  Lote,
  Midia,
  Parceiro,
  Projeto,
  ProjetoResumo,
  Servico,
  StatusLote,
  VideoInstagram,
} from "./tipos";
import { urlPublica } from "./url";

const TAMANHO_PAGINA = 1000;

// Client anon e sem cookies: respeita o RLS (só o publicado) e deixa as páginas
// serem geradas estaticamente e revalidadas.
let cliente: SupabaseClient | null = null;

function supabase() {
  cliente ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cliente;
}

type Resposta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

function exigir<T>(resultado: { data: T | null; error: { message: string } | null }, contexto: string): T | null {
  if (resultado.error) throw new Error(`Falha ao buscar ${contexto}: ${resultado.error.message}`);
  return resultado.data;
}

async function buscarTodas<T>(contexto: string, montar: (de: number, ate: number) => Resposta<T>): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const pagina = exigir(await montar(de, de + TAMANHO_PAGINA - 1), contexto) ?? [];
    linhas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return linhas;
  }
}

type LinhaConfiguracoes = {
  whatsapp: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  mapa_url: string | null;
  instagram_url: string | null;
  instagram_usuario: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  sobre_titulo: string | null;
  sobre_texto: string | null;
  google_avaliacoes_url: string | null;
  google_avaliar_url: string | null;
  google_nota: number | string | null;
  google_total: number | null;
};

type LinhaBanner = {
  id: string;
  sobrancelha: string;
  titulo: string;
  titulo_destaque: string | null;
  texto: string;
  mensagem_whatsapp: string | null;
  botao_rotulo: string | null;
  botao_href: string | null;
  imagem_path: string;
  imagem_posicao: string | null;
  legenda: string | null;
};

type LinhaServico = {
  id: string;
  slug: string;
  frente: FrenteServico;
  titulo: string;
  subtitulo: string | null;
  resumo: string | null;
  conteudo: string | null;
  itens: string[] | null;
  icone: string | null;
  foto_path: string | null;
  mensagem_whatsapp: string | null;
};

type LinhaMidia = {
  id: string;
  tipo: Midia["tipo"];
  storage_path: string;
  legenda: string | null;
};

type LinhaProjeto = {
  id: string;
  slug: string;
  titulo: string;
  cidade: string | null;
  categoria: CategoriaProjeto;
  descricao: string | null;
  capa_path: string | null;
  concluido_em: string | null;
};

type LinhaLoteamento = {
  id: string;
  slug: string;
  nome: string;
  cidade: string | null;
  endereco: string | null;
  maps_url: string | null;
  descricao: string | null;
  capa_path: string | null;
  banner_path: string | null;
  banner_mobile_path: string | null;
  mapa_svg_path: string | null;
};

type LinhaLote = {
  id: string;
  svg_id: string | null;
  quadra: string;
  numero: string;
  area_m2: number | string | null;
  status: StatusLote;
  observacao: string | null;
};

type LinhaDepoimento = {
  id: string;
  nome: string;
  cidade: string | null;
  texto: string;
  origem: Depoimento["origem"];
  nota: number | null;
  quando: string | null;
};

type LinhaParceiro = {
  id: string;
  nome: string;
  logo_path: string;
  site_url: string | null;
};

type LinhaVideo = {
  id: string;
  video_path: string;
  poster_path: string | null;
  legenda: string | null;
};

function numeroOuNulo(valor: number | string | null) {
  return valor === null ? null : Number(valor);
}

const CARACTERE_INVALIDO_EM_URL = /[\s\u0000-\u001f\u007f\\]/;
const CAMINHO_RELATIVO = /^\/(?!\/)/;
const ANCORA = /^#[A-Za-z0-9_-]+$/;

// Última trava antes do HTML público, além das constraints do banco: só sai
// link https:// (ou, com relativo, caminho do próprio site "/..." ou âncora
// "#id"). Qualquer outra coisa (javascript:, //outro-site, http://) vira null.
export function urlSegura(valor: string | null | undefined, { relativo = false }: { relativo?: boolean } = {}) {
  if (!valor || CARACTERE_INVALIDO_EM_URL.test(valor)) return null;
  if (relativo && (CAMINHO_RELATIVO.test(valor) || ANCORA.test(valor))) return valor;
  if (!valor.startsWith("https://")) return null;

  try {
    return new URL(valor).protocol === "https:" ? valor : null;
  } catch {
    return null;
  }
}

function paraServico(linha: LinhaServico): Servico {
  return {
    id: linha.id,
    slug: linha.slug,
    frente: linha.frente,
    titulo: linha.titulo,
    subtitulo: linha.subtitulo,
    resumo: linha.resumo,
    conteudo: linha.conteudo,
    itens: linha.itens ?? [],
    icone: linha.icone,
    fotoUrl: urlPublica(linha.foto_path),
    mensagemWhatsApp: linha.mensagem_whatsapp,
  };
}

function paraMidia(linha: LinhaMidia): Midia {
  return { id: linha.id, tipo: linha.tipo, url: urlPublica(linha.storage_path), legenda: linha.legenda };
}

function paraProjetoResumo(linha: LinhaProjeto): ProjetoResumo {
  return {
    id: linha.id,
    slug: linha.slug,
    titulo: linha.titulo,
    cidade: linha.cidade,
    categoria: linha.categoria,
    descricao: linha.descricao,
    capaUrl: urlPublica(linha.capa_path),
    concluidoEm: linha.concluido_em,
  };
}

function paraLoteamentoResumo(linha: LinhaLoteamento, lotesDisponiveis: number, totalLotes: number): LoteamentoResumo {
  return {
    id: linha.id,
    slug: linha.slug,
    nome: linha.nome,
    cidade: linha.cidade,
    capaUrl: urlPublica(linha.capa_path),
    bannerUrl: urlPublica(linha.banner_path),
    lotesDisponiveis,
    totalLotes,
  };
}

function paraLote(linha: LinhaLote): Lote {
  return {
    id: linha.id,
    svgId: linha.svg_id,
    quadra: linha.quadra,
    numero: linha.numero,
    areaM2: numeroOuNulo(linha.area_m2),
    status: linha.status,
    observacao: linha.observacao,
  };
}

const COLUNAS_SERVICO =
  "id, slug, frente, titulo, subtitulo, resumo, conteudo, itens, icone, foto_path, mensagem_whatsapp";
const COLUNAS_PROJETO = "id, slug, titulo, cidade, categoria, descricao, capa_path, concluido_em";
const COLUNAS_LOTEAMENTO =
  "id, slug, nome, cidade, endereco, maps_url, descricao, capa_path, banner_path, banner_mobile_path, mapa_svg_path";
const COLUNAS_LOTE = "id, svg_id, quadra, numero, area_m2, status, observacao";

const ordemNatural = new Intl.Collator("pt-BR", { numeric: true });

export const obterConfiguracoes = cache(async (): Promise<Configuracoes> => {
  const resultado = await supabase()
    .from("configuracoes_site")
    .select(
      "whatsapp, email, telefone, endereco, mapa_url, instagram_url, instagram_usuario, facebook_url, linkedin_url, sobre_titulo, sobre_texto, google_avaliacoes_url, google_avaliar_url, google_nota, google_total",
    )
    .limit(1)
    .maybeSingle<LinhaConfiguracoes>();
  const linha = exigir(resultado, "as configurações do site");
  return {
    whatsapp: linha?.whatsapp ?? null,
    email: linha?.email ?? null,
    telefone: linha?.telefone ?? null,
    endereco: linha?.endereco ?? null,
    mapaUrl: urlSegura(linha?.mapa_url),
    instagramUrl: urlSegura(linha?.instagram_url),
    instagramUsuario: linha?.instagram_usuario ?? null,
    facebookUrl: urlSegura(linha?.facebook_url),
    linkedinUrl: urlSegura(linha?.linkedin_url),
    sobreTitulo: linha?.sobre_titulo ?? null,
    sobreTexto: linha?.sobre_texto ?? null,
    googleAvaliacoesUrl: urlSegura(linha?.google_avaliacoes_url),
    googleAvaliarUrl: urlSegura(linha?.google_avaliar_url),
    googleNota: linha ? numeroOuNulo(linha.google_nota) : null,
    googleTotal: linha?.google_total ?? null,
  };
});

export const listarBannersHero = cache(async (): Promise<BannerHero[]> => {
  const resultado = await supabase()
    .from("banners_hero")
    .select(
      "id, sobrancelha, titulo, titulo_destaque, texto, mensagem_whatsapp, botao_rotulo, botao_href, imagem_path, imagem_posicao, legenda",
    )
    .order("ordem")
    .order("titulo")
    .returns<LinhaBanner[]>();
  return (exigir(resultado, "os banners do topo") ?? []).map((linha) => ({
    id: linha.id,
    sobrancelha: linha.sobrancelha,
    titulo: linha.titulo,
    tituloDestaque: linha.titulo_destaque,
    texto: linha.texto,
    mensagemWhatsApp: linha.mensagem_whatsapp,
    botaoRotulo: linha.botao_rotulo,
    botaoHref: urlSegura(linha.botao_href, { relativo: true }),
    imagemUrl: urlPublica(linha.imagem_path),
    imagemPosicao: linha.imagem_posicao ?? "center",
    legenda: linha.legenda,
  }));
});

export const listarServicos = cache(async (frente?: FrenteServico): Promise<Servico[]> => {
  let consulta = supabase().from("servicos").select(COLUNAS_SERVICO);
  if (frente) consulta = consulta.eq("frente", frente);
  const resultado = await consulta.order("ordem").order("titulo").returns<LinhaServico[]>();
  return (exigir(resultado, "os serviços") ?? []).map(paraServico);
});

export const obterServico = cache(async (slug: string): Promise<Servico | null> => {
  const resultado = await supabase()
    .from("servicos")
    .select(COLUNAS_SERVICO)
    .eq("slug", slug)
    .maybeSingle<LinhaServico>();
  const linha = exigir(resultado, "o serviço");
  return linha ? paraServico(linha) : null;
});

export const listarProjetos = cache(async (): Promise<ProjetoResumo[]> => {
  const resultado = await supabase()
    .from("portfolio_projetos")
    .select(COLUNAS_PROJETO)
    .order("ordem")
    .order("titulo")
    .returns<LinhaProjeto[]>();
  return (exigir(resultado, "os projetos") ?? []).map(paraProjetoResumo);
});

export const obterProjeto = cache(async (slug: string): Promise<Projeto | null> => {
  const resultado = await supabase()
    .from("portfolio_projetos")
    .select(COLUNAS_PROJETO)
    .eq("slug", slug)
    .maybeSingle<LinhaProjeto>();
  const linha = exigir(resultado, "o projeto");
  if (!linha) return null;

  const midias = await supabase()
    .from("midias")
    .select("id, tipo, storage_path, legenda")
    .eq("portfolio_projeto_id", linha.id)
    .order("ordem")
    .order("criado_em")
    .returns<LinhaMidia[]>();
  return { ...paraProjetoResumo(linha), midias: (exigir(midias, "as mídias do projeto") ?? []).map(paraMidia) };
});

export const listarLoteamentos = cache(async (): Promise<LoteamentoResumo[]> => {
  const resultado = await supabase()
    .from("loteamentos")
    .select(COLUNAS_LOTEAMENTO)
    .order("ordem")
    .order("nome")
    .returns<LinhaLoteamento[]>();
  const loteamentos = exigir(resultado, "os loteamentos") ?? [];

  const lotes = await buscarTodas<{ loteamento_id: string; status: StatusLote }>("os lotes", (de, ate) =>
    supabase()
      .from("lotes")
      .select("loteamento_id, status")
      .order("id")
      .range(de, ate)
      .returns<{ loteamento_id: string; status: StatusLote }[]>(),
  );
  const totais = new Map<string, { disponiveis: number; total: number }>();
  for (const lote of lotes) {
    const contagem = totais.get(lote.loteamento_id) ?? { disponiveis: 0, total: 0 };
    contagem.total += 1;
    if (lote.status === "disponivel") contagem.disponiveis += 1;
    totais.set(lote.loteamento_id, contagem);
  }

  return loteamentos.map((linha) =>
    paraLoteamentoResumo(linha, totais.get(linha.id)?.disponiveis ?? 0, totais.get(linha.id)?.total ?? 0),
  );
});

export const obterLoteamento = cache(async (slug: string): Promise<Loteamento | null> => {
  const resultado = await supabase()
    .from("loteamentos")
    .select(COLUNAS_LOTEAMENTO)
    .eq("slug", slug)
    .maybeSingle<LinhaLoteamento>();
  const linha = exigir(resultado, "o loteamento");
  if (!linha) return null;

  const linhasLotes = await buscarTodas<LinhaLote>("os lotes do loteamento", (de, ate) =>
    supabase()
      .from("lotes")
      .select(COLUNAS_LOTE)
      .eq("loteamento_id", linha.id)
      .order("id")
      .range(de, ate)
      .returns<LinhaLote[]>(),
  );
  const lotes = linhasLotes
    .map(paraLote)
    .sort((a, b) => ordemNatural.compare(a.quadra, b.quadra) || ordemNatural.compare(a.numero, b.numero));

  const midias = await supabase()
    .from("midias")
    .select("id, tipo, storage_path, legenda")
    .eq("loteamento_id", linha.id)
    .order("ordem")
    .order("criado_em")
    .returns<LinhaMidia[]>();

  const disponiveis = lotes.filter((lote) => lote.status === "disponivel").length;
  return {
    ...paraLoteamentoResumo(linha, disponiveis, lotes.length),
    endereco: linha.endereco,
    mapsUrl: urlSegura(linha.maps_url),
    descricao: linha.descricao,
    bannerMobileUrl: urlPublica(linha.banner_mobile_path),
    mapaSvgUrl: urlPublica(linha.mapa_svg_path),
    lotes,
    midias: (exigir(midias, "as mídias do loteamento") ?? []).map(paraMidia),
  };
});

// /contato?loteamento=<slug> só precisa do nome para o texto do interesse.
export const obterLoteamentoParaContato = cache(async (slug: string): Promise<{ id: string; nome: string } | null> => {
  const resultado = await supabase()
    .from("loteamentos")
    .select("id, nome")
    .eq("slug", slug)
    .maybeSingle<{ id: string; nome: string }>();
  return exigir(resultado, "o loteamento");
});

export const listarDepoimentos = cache(async (): Promise<Depoimento[]> => {
  const resultado = await supabase()
    .from("depoimentos")
    .select("id, nome, cidade, texto, origem, nota, quando")
    .order("ordem")
    .order("nome")
    .returns<LinhaDepoimento[]>();
  return (exigir(resultado, "os depoimentos") ?? []).map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    cidade: linha.cidade,
    texto: linha.texto,
    origem: linha.origem,
    nota: linha.nota,
    quando: linha.quando,
  }));
});

export const listarParceiros = cache(async (): Promise<Parceiro[]> => {
  const resultado = await supabase()
    .from("parceiros")
    .select("id, nome, logo_path, site_url")
    .order("ordem")
    .order("nome")
    .returns<LinhaParceiro[]>();
  return (exigir(resultado, "os parceiros") ?? []).map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    logoUrl: urlPublica(linha.logo_path),
    siteUrl: urlSegura(linha.site_url),
  }));
});

export const listarVideosInstagram = cache(async (): Promise<VideoInstagram[]> => {
  const resultado = await supabase()
    .from("videos_instagram")
    .select("id, video_path, poster_path, legenda")
    .order("ordem")
    .order("criado_em")
    .returns<LinhaVideo[]>();
  return (exigir(resultado, "os vídeos do Instagram") ?? []).map((linha) => ({
    id: linha.id,
    videoUrl: urlPublica(linha.video_path),
    posterUrl: urlPublica(linha.poster_path),
    legenda: linha.legenda,
  }));
});
