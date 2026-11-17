import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { StatusLote } from "@/lib/conteudo/tipos";

// Leituras do admin: client da sessão, então a equipe enxerga também os rascunhos.

const TAMANHO_PAGINA = 1000;

export type LoteamentoAdmin = {
  id: string;
  nome: string;
  slug: string;
  cidade: string | null;
  endereco: string | null;
  mapsUrl: string | null;
  descricao: string | null;
  capaPath: string | null;
  bannerPath: string | null;
  bannerMobilePath: string | null;
  mapaSvgPath: string | null;
  publicado: boolean;
};

export type ResumoLoteamentoAdmin = LoteamentoAdmin & {
  totalLotes: number;
  disponiveis: number;
};

export type LoteAdmin = {
  id: string;
  svgId: string | null;
  quadra: string;
  numero: string;
  areaM2: number | null;
  status: StatusLote;
  observacao: string | null;
};

export type MidiaAdmin = {
  id: string;
  tipo: "foto" | "video";
  path: string;
  legenda: string | null;
};

type LinhaLoteamento = {
  id: string;
  nome: string;
  slug: string;
  cidade: string | null;
  endereco: string | null;
  maps_url: string | null;
  descricao: string | null;
  capa_path: string | null;
  banner_path: string | null;
  banner_mobile_path: string | null;
  mapa_svg_path: string | null;
  publicado: boolean;
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

const COLUNAS_LOTEAMENTO =
  "id, nome, slug, cidade, endereco, maps_url, descricao, capa_path, banner_path, banner_mobile_path, mapa_svg_path, publicado";

const ordemNatural = new Intl.Collator("pt-BR", { numeric: true });

function paraLoteamento(linha: LinhaLoteamento): LoteamentoAdmin {
  return {
    id: linha.id,
    nome: linha.nome,
    slug: linha.slug,
    cidade: linha.cidade,
    endereco: linha.endereco,
    mapsUrl: linha.maps_url,
    descricao: linha.descricao,
    capaPath: linha.capa_path,
    bannerPath: linha.banner_path,
    bannerMobilePath: linha.banner_mobile_path,
    mapaSvgPath: linha.mapa_svg_path,
    publicado: linha.publicado,
  };
}

function exigir<T>(resultado: { data: T | null; error: { code?: string } | null }, contexto: string): T {
  if (resultado.error || resultado.data === null) {
    throw new Error(`Falha ao buscar ${contexto} (${resultado.error?.code ?? "sem dados"}).`);
  }
  return resultado.data;
}

type LinhaLoteComDono = LinhaLote & { loteamento_id: string };

async function lerLotes(filtroLoteamentoId?: string) {
  const supabase = await createClient();
  const linhas: LinhaLoteComDono[] = [];

  for (let de = 0; ; de += TAMANHO_PAGINA) {
    let consulta = supabase
      .from("lotes")
      .select("id, loteamento_id, svg_id, quadra, numero, area_m2, status, observacao");
    if (filtroLoteamentoId) consulta = consulta.eq("loteamento_id", filtroLoteamentoId);

    const pagina = exigir(
      await consulta.order("id").range(de, de + TAMANHO_PAGINA - 1).returns<LinhaLoteComDono[]>(),
      "os lotes",
    );
    linhas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return linhas;
  }
}

export async function listarLoteamentosAdmin(): Promise<ResumoLoteamentoAdmin[]> {
  const supabase = await createClient();
  const resultado = await supabase
    .from("loteamentos")
    .select(COLUNAS_LOTEAMENTO)
    .order("ordem")
    .order("nome")
    .returns<LinhaLoteamento[]>();
  const loteamentos = exigir(resultado, "os loteamentos");

  const lotes = await lerLotes();
  const totais = new Map<string, { total: number; disponiveis: number }>();
  for (const lote of lotes) {
    const contagem = totais.get(lote.loteamento_id) ?? { total: 0, disponiveis: 0 };
    contagem.total += 1;
    if (lote.status === "disponivel") contagem.disponiveis += 1;
    totais.set(lote.loteamento_id, contagem);
  }

  return loteamentos.map((linha) => ({
    ...paraLoteamento(linha),
    totalLotes: totais.get(linha.id)?.total ?? 0,
    disponiveis: totais.get(linha.id)?.disponiveis ?? 0,
  }));
}

export async function obterLoteamentoAdmin(id: string) {
  const supabase = await createClient();
  const resultado = await supabase
    .from("loteamentos")
    .select(COLUNAS_LOTEAMENTO)
    .eq("id", id)
    .maybeSingle<LinhaLoteamento>();
  if (resultado.error) throw new Error(`Falha ao buscar o loteamento (${resultado.error.code}).`);
  if (!resultado.data) return null;

  const midias = exigir(
    await supabase
      .from("midias")
      .select("id, tipo, storage_path, legenda")
      .eq("loteamento_id", id)
      .order("ordem")
      .order("criado_em")
      .returns<{ id: string; tipo: "foto" | "video"; storage_path: string; legenda: string | null }[]>(),
    "a galeria",
  );

  const lotes: LoteAdmin[] = (await lerLotes(id))
    .map((linha) => ({
      id: linha.id,
      svgId: linha.svg_id,
      quadra: linha.quadra,
      numero: linha.numero,
      areaM2: linha.area_m2 === null ? null : Number(linha.area_m2),
      status: linha.status,
      observacao: linha.observacao,
    }))
    .sort((a, b) => ordemNatural.compare(a.quadra, b.quadra) || ordemNatural.compare(a.numero, b.numero));

  return {
    loteamento: paraLoteamento(resultado.data),
    midias: midias.map((midia) => ({
      id: midia.id,
      tipo: midia.tipo,
      path: midia.storage_path,
      legenda: midia.legenda,
    })) satisfies MidiaAdmin[],
    lotes,
  };
}

// Muda quando qualquer dado muda: usado como `key` para o componente de cliente
// recomeçar do que veio do servidor depois de um router.refresh().
export function assinatura(partes: unknown[]) {
  const texto = JSON.stringify(partes);
  let hash = 5381;
  for (let i = 0; i < texto.length; i += 1) {
    hash = ((hash << 5) + hash + texto.charCodeAt(i)) | 0;
  }
  return `${texto.length}-${hash}`;
}
