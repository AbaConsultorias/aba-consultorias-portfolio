import { BadRequestError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import { atualizarSite, erroDoBanco, limitarEscrita } from "../loteamentos/banco";
import type { AtualizarLoteInput, CriarLoteInput, CriarLotesEmMassaInput } from "./schema";

const DUPLICADO = "Já existe um lote com essa quadra e número, ou com esse código do mapa, neste loteamento.";
const NAO_ENCONTRADO = "Lote não encontrado.";

export async function criarLote(entrada: CriarLoteInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lotes")
    .insert({
      loteamento_id: entrada.loteamentoId,
      quadra: entrada.quadra,
      numero: entrada.numero,
      area_m2: entrada.areaM2 ?? null,
      svg_id: entrada.svgId ?? null,
      observacao: entrada.observacao ?? null,
      status: entrada.status,
    })
    .select("id")
    .single();
  if (error) erroDoBanco(error, "lotes", DUPLICADO);

  atualizarSite();
  return { id: (data as { id: string }).id };
}

export async function criarLotesEmMassa(entrada: CriarLotesEmMassaInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data: existentes, error: erroLeitura } = await supabase
    .from("lotes")
    .select("numero")
    .eq("loteamento_id", entrada.loteamentoId)
    .eq("quadra", entrada.quadra);
  if (erroLeitura) erroDoBanco(erroLeitura, "lotes", DUPLICADO);

  const jaCadastrados = new Set((existentes as { numero: string }[]).map((lote) => lote.numero));
  const novos: Record<string, string | number | null>[] = [];
  for (let numero = entrada.de; numero <= entrada.ate; numero += 1) {
    if (jaCadastrados.has(String(numero))) continue;
    novos.push({
      loteamento_id: entrada.loteamentoId,
      quadra: entrada.quadra,
      numero: String(numero),
      area_m2: entrada.areaM2 ?? null,
      status: entrada.status,
    });
  }

  if (novos.length > 0) {
    const { error } = await supabase.from("lotes").insert(novos);
    if (error) erroDoBanco(error, "lotes", DUPLICADO);
    atualizarSite();
  }

  return { criados: novos.length, ignorados: entrada.ate - entrada.de + 1 - novos.length };
}

export async function atualizarLote(id: string, entrada: AtualizarLoteInput, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const alteracoes: Record<string, string | number | null> = {};
  if (entrada.quadra !== undefined) alteracoes.quadra = entrada.quadra;
  if (entrada.numero !== undefined) alteracoes.numero = entrada.numero;
  if (entrada.areaM2 !== undefined) alteracoes.area_m2 = entrada.areaM2;
  if (entrada.svgId !== undefined) alteracoes.svg_id = entrada.svgId;
  if (entrada.observacao !== undefined) alteracoes.observacao = entrada.observacao;
  if (entrada.status !== undefined) alteracoes.status = entrada.status;

  const supabase = await createClient();
  const { data, error } = await supabase.from("lotes").update(alteracoes).eq("id", id).select("id");
  if (error) erroDoBanco(error, "lotes", DUPLICADO);
  if (!data || data.length === 0) throw new BadRequestError(NAO_ENCONTRADO);

  atualizarSite();
}

export async function excluirLote(id: string, usuarioId: string) {
  await limitarEscrita(usuarioId);

  const supabase = await createClient();
  const { data, error } = await supabase.from("lotes").delete().eq("id", id).select("id");
  if (error) erroDoBanco(error, "lotes", DUPLICADO);
  if (!data || data.length === 0) throw new BadRequestError(NAO_ENCONTRADO);

  atualizarSite();
}
