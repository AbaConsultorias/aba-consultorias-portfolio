import "server-only";
import z from "zod";
import { BadRequestError, ForbiddenError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import type { Permissao } from "@/lib/auth/permissoes";
import { createClient } from "@/lib/supabase/server";
import { armazenamentoPadrao, type Armazenamento } from "@/lib/portal/documentos/armazenamento";
import { CAMPOS_DOCUMENTO_ADMIN, documentoAdminSchema, falhaDeBanco, listarDocumentosAdmin, paraAdmin } from "@/lib/portal/documentos/consultas";
import { paisValidos } from "@/lib/portal/documentos/relacoes";
import type { DocumentoAdmin } from "@/lib/portal/documentos/tipos";
import type { Pagina } from "@/lib/portal/comum/tipos";
import type { AtualizarInput, ConsultaInput } from "./schema";

export type DependenciasDocumentos = {
  criarSessao: typeof createClient;
  armazenamento: Pick<Armazenamento, "removerObjeto">;
};

const dependenciasPadrao: DependenciasDocumentos = { criarSessao: createClient, armazenamento: armazenamentoPadrao };
const NAO_ENCONTRADO = "Documento não encontrado.";
const PAIS_INVALIDOS = "Projeto ou categoria não pertence a este empreendimento.";
const linhaSchema = z.object({
  id: z.uuid(),
  empreendimento_id: z.uuid(),
  projeto_id: z.uuid().nullable(),
  categoria_id: z.uuid().nullable(),
  mime: z.string(),
  storage_path: z.string(),
  liberado_cliente: z.boolean(),
});

// A mesma gravação mistura campos de duas permissões: cada campo enviado exige a sua, e nada é ignorado em silêncio.
export function exigirPermissoesDaAlteracao(entrada: AtualizarInput, permissoes: ReadonlySet<Permissao>): void {
  const mexeNoCadastro = entrada.titulo !== undefined || entrada.projetoId !== undefined || entrada.categoriaId !== undefined;
  if (mexeNoCadastro && !permissoes.has("documentos.editar")) throw new ForbiddenError("Acesso negado.");
  if (entrada.liberado !== undefined && !permissoes.has("documentos.liberar")) throw new ForbiddenError("Acesso negado.");
}

export function listar(consulta: ConsultaInput): Promise<Pagina<DocumentoAdmin>> {
  return listarDocumentosAdmin(
    { empreendimentoId: consulta.empreendimentoId, projetoId: consulta.projetoId, liberado: consulta.liberado },
    { pagina: consulta.pagina, limite: consulta.limite },
  );
}

async function obterLinha(sessao: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await sessao.from("documentos")
    .select("id,empreendimento_id,projeto_id,categoria_id,mime,storage_path,liberado_cliente").eq("id", id).maybeSingle();
  if (error) falhaDeBanco(error);
  if (data === null) throw new NotFoundError(NAO_ENCONTRADO);
  const linha = linhaSchema.safeParse(data as unknown);
  if (!linha.success) throw new InternalServerError(null);
  return linha.data;
}

export async function atualizar(entrada: AtualizarInput, dependencias: DependenciasDocumentos = dependenciasPadrao): Promise<DocumentoAdmin> {
  const sessao = await dependencias.criarSessao();
  const linha = await obterLinha(sessao, entrada.id);
  const campos: Record<string, string | boolean | null> = {};

  if (entrada.titulo !== undefined) campos.titulo = entrada.titulo;
  if (entrada.liberado !== undefined) {
    if (entrada.liberado && linha.mime !== "application/pdf") throw new BadRequestError("Só PDF pode ser liberado para o cliente.");
    campos.liberado_cliente = entrada.liberado;
  }

  if (entrada.projetoId !== undefined || entrada.categoriaId !== undefined) {
    const projeto = entrada.projetoId !== undefined ? entrada.projetoId : linha.projeto_id;
    // A categoria pertence a um projeto: ao trocar o projeto sem escolher outra, a antiga deixa de valer.
    const trocouProjeto = entrada.projetoId !== undefined && entrada.projetoId !== linha.projeto_id;
    const categoria = entrada.categoriaId !== undefined ? entrada.categoriaId : trocouProjeto ? null : linha.categoria_id;
    if (!await paisValidos(sessao, { empreendimentoId: linha.empreendimento_id, projetoId: projeto, categoriaId: projeto ? categoria : null })
      || (!projeto && categoria)) throw new BadRequestError(PAIS_INVALIDOS);
    campos.projeto_id = projeto;
    campos.categoria_id = projeto ? categoria : null;
    // Contrato/orçamento/arquivo movido para um projeto deixa de ser do grupo (CHECK documentos_grupo_sem_projeto_check) e
    // perde o rótulo do cartão (pasta_rotulo existe só no grupo "arquivo"). O admin não troca o grupo para "arquivo".
    if (projeto) {
      campos.grupo = null;
      campos.pasta_rotulo = null;
    }
  }

  // liberado_por/liberado_em ficam por conta do carimbo do banco.
  const { data, error } = await sessao.from("documentos").update(campos).eq("id", entrada.id)
    .select(CAMPOS_DOCUMENTO_ADMIN).maybeSingle();
  if (error) {
    if (error.code === "23514" || error.code === "23503") throw new BadRequestError(PAIS_INVALIDOS);
    falhaDeBanco(error);
  }
  if (data === null) throw new NotFoundError(NAO_ENCONTRADO);
  const resultado = documentoAdminSchema.safeParse(data as unknown);
  if (!resultado.success) throw new InternalServerError(null);
  return paraAdmin(resultado.data);
}

// Ordem: oculta → apaga o objeto → apaga a linha. Se o Storage falhar, o registro continua oculto e a exclusão
// pode ser repetida; se a linha falhar, repetir apaga o objeto de novo (idempotente) e tenta a linha outra vez.
export async function excluir(id: string, permissoes: ReadonlySet<Permissao>, dependencias: DependenciasDocumentos = dependenciasPadrao): Promise<{ id: string }> {
  const sessao = await dependencias.criarSessao();
  const linha = await obterLinha(sessao, id);
  if (linha.liberado_cliente && !permissoes.has("documentos.liberar")) throw new ForbiddenError("Acesso negado.");
  if (!linha.storage_path.startsWith(`${linha.empreendimento_id}/`) || linha.storage_path.split("/").some((parte) => parte === ".." || parte === "")) {
    throw new InternalServerError(null);
  }

  if (linha.liberado_cliente) {
    const { data, error } = await sessao.from("documentos").update({ liberado_cliente: false }).eq("id", id).select("id");
    if (error) falhaDeBanco(error);
    if (data.length === 0) throw new NotFoundError(NAO_ENCONTRADO);
  }

  await dependencias.armazenamento.removerObjeto(linha.storage_path);

  const { error } = await sessao.from("documentos").delete().eq("id", id);
  if (error) falhaDeBanco(error);
  return { id };
}
