import "server-only";
import z from "zod";
import { NotFoundError } from "@/app/api/HttpErrors";
import type { ItemDoCatalogo } from "@/lib/conector/montagem";
import { GRUPOS_DE_DOCUMENTO } from "@/lib/conector/sugestoes";
import { conferirErro, ler } from "@/lib/portal/andamento/servidor";
import { createClient } from "@/lib/supabase/server";
import type { AtualizarCatalogoInput } from "./schema";

type Sessao = Awaited<ReturnType<typeof createClient>>;
export type ItemDoCatalogoCompleto = ItemDoCatalogo & { id: string };

const COLUNAS = "id,chave,rotulo,raiz,termos,termos_excluir,fase,tipo,modelo_id,nome_projeto,categoria,grupo,subpastas,depende_de,destino_equipamentos,cria_regras,ordem,ativo";
const LIMITE_DO_CATALOGO = 200;

const linhaSchema = z.object({
  id: z.uuid(),
  chave: z.string(),
  rotulo: z.string(),
  raiz: z.string(),
  termos: z.string().array(),
  termos_excluir: z.string().array(),
  fase: z.enum(["base", "complementar"]),
  tipo: z.enum(["projeto", "grupo", "equipamentos", "arquivo"]),
  modelo_id: z.uuid().nullable(),
  nome_projeto: z.string().nullable(),
  categoria: z.string().nullable(),
  grupo: z.enum(GRUPOS_DE_DOCUMENTO).nullable(),
  subpastas: z.string().array().array().array(),
  depende_de: z.string().nullable(),
  destino_equipamentos: z.string().nullable(),
  cria_regras: z.boolean(),
  ordem: z.number().int(),
  ativo: z.boolean(),
});

export async function listarCatalogo(sessao?: Sessao): Promise<ItemDoCatalogoCompleto[]> {
  const cliente = sessao ?? await createClient();
  const { data, error } = await cliente.from("catalogo_pastas").select(COLUNAS).order("ordem").order("chave").limit(LIMITE_DO_CATALOGO);
  conferirErro(error);
  return ler(linhaSchema.array(), data as unknown).map((linha) => ({
    id: linha.id,
    chave: linha.chave,
    rotulo: linha.rotulo,
    raiz: linha.raiz,
    termos: linha.termos,
    termosExcluir: linha.termos_excluir,
    fase: linha.fase,
    tipo: linha.tipo,
    modeloId: linha.modelo_id,
    nomeProjeto: linha.nome_projeto,
    categoria: linha.categoria,
    grupo: linha.grupo,
    subpastas: linha.subpastas,
    dependeDe: linha.depende_de,
    destinoEquipamentos: linha.destino_equipamentos,
    criaRegras: linha.cria_regras,
    ordem: linha.ordem,
    ativo: linha.ativo,
  }));
}

// Os CHECKs do banco (forma, tamanho, termos) são a segunda barreira; a escrita só passa pelo RLS do admin.
export async function atualizarCatalogo(entrada: AtualizarCatalogoInput): Promise<{ id: string }> {
  const sessao = await createClient();
  const campos: Record<string, unknown> = {};
  if (entrada.termos !== undefined) campos.termos = entrada.termos;
  if (entrada.termosExcluir !== undefined) campos.termos_excluir = entrada.termosExcluir;
  if (entrada.subpastas !== undefined) campos.subpastas = entrada.subpastas;
  if (entrada.nomeProjeto !== undefined) campos.nome_projeto = entrada.nomeProjeto;
  if (entrada.categoria !== undefined) campos.categoria = entrada.categoria;
  if (entrada.modeloId !== undefined) campos.modelo_id = entrada.modeloId;
  if (entrada.ativo !== undefined) campos.ativo = entrada.ativo;
  if (entrada.ordem !== undefined) campos.ordem = entrada.ordem;

  const { data, error } = await sessao.from("catalogo_pastas").update(campos).eq("id", entrada.id).select("id").maybeSingle();
  conferirErro(error);
  if (!data) throw new NotFoundError("Item do catálogo não encontrado.");
  return ler(z.object({ id: z.uuid() }), data as unknown);
}
