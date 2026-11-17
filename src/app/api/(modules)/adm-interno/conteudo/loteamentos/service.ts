import { BadRequestError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { exigirArquivoConferido } from "../upload/service";
import { atualizarSite, erroDoBanco, limitarEscrita, removerArquivos, removerPasta } from "./banco";
import type {
  AdicionarMidiaInput,
  AtualizarLoteamentoInput,
  AtualizarMidiaInput,
  CriarLoteamentoInput,
  OrdenarInput,
} from "./schema";

const SLUG_DUPLICADO = "Já existe um loteamento com esse endereço de página. Escolha outro.";
const NAO_ENCONTRADO = "Loteamento não encontrado.";

type LinhaCaminhos = {
  capa_path: string | null;
  banner_path: string | null;
  banner_mobile_path: string | null;
  mapa_svg_path: string | null;
};

const CAMPOS_DE_ARQUIVO = [
  ["capaPath", "capa_path"],
  ["bannerPath", "banner_path"],
  ["bannerMobilePath", "banner_mobile_path"],
  ["mapaSvgPath", "mapa_svg_path"],
] as const;

function exigirPastaDoLoteamento(id: string, path: string | null | undefined) {
  if (path && !path.startsWith(`loteamentos/${id}/`)) {
    throw new BadRequestError("Arquivo não pertence a este loteamento.");
  }
}

async function proximaOrdem(tabela: "loteamentos" | "midias", filtro?: { loteamentoId: string }) {
  const supabase = await createClient();
  let consulta = supabase.from(tabela).select("ordem");
  if (filtro) consulta = consulta.eq("loteamento_id", filtro.loteamentoId);

  const { data, error } = await consulta.order("ordem", { ascending: false }).limit(1);
  if (error) erroDoBanco(error, "loteamentos", "");
  return ((data as { ordem: number }[] | null)?.[0]?.ordem ?? 0) + 1;
}

export async function criarLoteamento(entrada: CriarLoteamentoInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const ordem = await proximaOrdem("loteamentos");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loteamentos")
    .insert({
      nome: entrada.nome,
      slug: entrada.slug,
      cidade: entrada.cidade ?? null,
      endereco: entrada.endereco ?? null,
      maps_url: entrada.mapsUrl ?? null,
      descricao: entrada.descricao ?? null,
      publicado: entrada.publicado,
      ordem,
    })
    .select("id")
    .single();

  if (error) erroDoBanco(error, "loteamentos", SLUG_DUPLICADO);

  atualizarSite();
  return { id: (data as { id: string }).id };
}

export async function atualizarLoteamento(id: string, entrada: AtualizarLoteamentoInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  for (const [campo] of CAMPOS_DE_ARQUIVO) exigirPastaDoLoteamento(id, entrada[campo]);

  const supabase = await createClient();
  const { data: atual, error: erroLeitura } = await supabase
    .from("loteamentos")
    .select("capa_path, banner_path, banner_mobile_path, mapa_svg_path")
    .eq("id", id)
    .maybeSingle<LinhaCaminhos>();
  if (erroLeitura) erroDoBanco(erroLeitura, "loteamentos", SLUG_DUPLICADO);
  if (!atual) throw new BadRequestError(NAO_ENCONTRADO);

  // O mapa SVG não passa pela URL assinada: a rota de upload o sanitiza antes de gravar.
  for (const [campo, coluna] of CAMPOS_DE_ARQUIVO) {
    if (coluna !== "mapa_svg_path") await exigirArquivoConferido(entrada[campo], "imagem", atual[coluna]);
  }

  const alteracoes: Record<string, string | boolean | null> = {};
  if (entrada.nome !== undefined) alteracoes.nome = entrada.nome;
  if (entrada.slug !== undefined) alteracoes.slug = entrada.slug;
  if (entrada.cidade !== undefined) alteracoes.cidade = entrada.cidade;
  if (entrada.endereco !== undefined) alteracoes.endereco = entrada.endereco;
  if (entrada.mapsUrl !== undefined) alteracoes.maps_url = entrada.mapsUrl;
  if (entrada.descricao !== undefined) alteracoes.descricao = entrada.descricao;
  if (entrada.publicado !== undefined) alteracoes.publicado = entrada.publicado;

  const substituidos: (string | null)[] = [];
  for (const [campo, coluna] of CAMPOS_DE_ARQUIVO) {
    if (entrada[campo] === undefined) continue;
    alteracoes[coluna] = entrada[campo];
    if (atual[coluna] !== entrada[campo]) substituidos.push(atual[coluna]);
  }

  const { error } = await supabase.from("loteamentos").update(alteracoes).eq("id", id);
  if (error) erroDoBanco(error, "loteamentos", SLUG_DUPLICADO);

  await removerArquivos(substituidos);
  atualizarSite();
}

export async function excluirLoteamento(id: string, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase.from("loteamentos").delete().eq("id", id).select("id");
  if (error) erroDoBanco(error, "loteamentos", SLUG_DUPLICADO);
  if (!data || data.length === 0) throw new BadRequestError(NAO_ENCONTRADO);

  await removerPasta(`loteamentos/${id}`);
  atualizarSite();
}

export async function reordenarLoteamentos({ ids }: OrdenarInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase.from("loteamentos").select("id");
  if (error) erroDoBanco(error, "loteamentos", SLUG_DUPLICADO);

  const existentes = new Set((data as { id: string }[]).map((linha) => linha.id));
  if (ids.length !== existentes.size || new Set(ids).size !== ids.length || !ids.every((id) => existentes.has(id))) {
    throw new BadRequestError("A lista não corresponde aos loteamentos cadastrados. Atualize a página.");
  }

  const resultados = await Promise.all(
    ids.map((id, indice) => supabase.from("loteamentos").update({ ordem: indice + 1 }).eq("id", id)),
  );
  const falha = resultados.find((resultado) => resultado.error);
  if (falha?.error) erroDoBanco(falha.error, "loteamentos", SLUG_DUPLICADO);

  atualizarSite();
}

async function exigirLoteamento(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("loteamentos").select("id").eq("id", id).maybeSingle();
  if (error) erroDoBanco(error, "loteamentos", SLUG_DUPLICADO);
  if (!data) throw new BadRequestError(NAO_ENCONTRADO);
}

export async function adicionarMidia(id: string, entrada: AdicionarMidiaInput, usuarioId: string) {
  await limitarEscrita(usuarioId);
  exigirPastaDoLoteamento(id, entrada.path);
  await exigirLoteamento(id);
  await exigirArquivoConferido(entrada.path, entrada.tipo === "video" ? "video" : "imagem");

  const ordem = await proximaOrdem("midias", { loteamentoId: id });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("midias")
    .insert({
      tipo: entrada.tipo,
      storage_path: entrada.path,
      legenda: entrada.legenda ?? null,
      ordem,
      loteamento_id: id,
    })
    .select("id")
    .single();
  if (error) erroDoBanco(error, "midias", "Esta mídia já foi adicionada.");

  atualizarSite();
  return { id: (data as { id: string }).id };
}

export async function reordenarMidias(id: string, { ids }: OrdenarInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase.from("midias").select("id").eq("loteamento_id", id);
  if (error) erroDoBanco(error, "midias", "");

  const existentes = new Set((data as { id: string }[]).map((linha) => linha.id));
  if (ids.length !== existentes.size || new Set(ids).size !== ids.length || !ids.every((midia) => existentes.has(midia))) {
    throw new BadRequestError("A lista não corresponde à galeria. Atualize a página.");
  }

  const resultados = await Promise.all(
    ids.map((midia, indice) =>
      supabase.from("midias").update({ ordem: indice + 1 }).eq("id", midia).eq("loteamento_id", id),
    ),
  );
  const falha = resultados.find((resultado) => resultado.error);
  if (falha?.error) erroDoBanco(falha.error, "midias", "");

  atualizarSite();
}

export async function atualizarMidia(id: string, midiaId: string, entrada: AtualizarMidiaInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("midias")
    .update({ legenda: entrada.legenda ?? null })
    .eq("id", midiaId)
    .eq("loteamento_id", id)
    .select("id");
  if (error) erroDoBanco(error, "midias", "");
  if (!data || data.length === 0) throw new BadRequestError("Mídia não encontrada.");

  atualizarSite();
}

export async function removerMidia(id: string, midiaId: string, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("midias")
    .delete()
    .eq("id", midiaId)
    .eq("loteamento_id", id)
    .select("storage_path");
  if (error) erroDoBanco(error, "midias", "");

  const removidas = data as { storage_path: string }[] | null;
  if (!removidas || removidas.length === 0) throw new BadRequestError("Mídia não encontrada.");

  await removerArquivos(removidas.map((midia) => midia.storage_path));
  atualizarSite();
}
