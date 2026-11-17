import "server-only";
import z from "zod";
import { HttpError, InternalServerError, NotFoundError } from "@/app/api/HttpErrors";
import { handleError } from "@/app/api/utils/handleError";
import { chaveIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { RegraAcesso } from "@/lib/auth/regras";
import { nomeArquivoPdf } from "@/lib/portal/documentos/regras";
import { presignGet } from "@/lib/r2/cliente";
import { autorizarPortal, type AcessoPortal } from "./servidor";
import type { UUID } from "./tipos";

export type TipoArquivoPrivado = "documento" | "atualizacao_foto" | "relato_foto" | "fornecedor_documento" | "fornecedor_contrato";
export type RegistroDownload = {
  arquivo_tipo: "documento" | "fornecedor_documento" | "fornecedor_contrato" | "foto_obra";
  arquivo_id: UUID;
  profile_id: UUID;
  ip_hash: string | null;
  em: string;
};
export type DependenciasArquivoPrivado = {
  autorizar: (acao: "download" | "foto", regra: RegraAcesso) => Promise<{
    user: Pick<AcessoPortal["user"], "id">;
    perfil: Pick<AcessoPortal["perfil"], "papel">;
  }>;
  criarSessao: typeof createClient;
  assinarUrl: (bucket: "obras" | "fornecedores", path: string, segundos: number, anexo: boolean) => Promise<string>;
  // Documentos de cliente ficam no R2, não no Supabase Storage.
  assinarUrlDocumento: (path: string, segundos: number, nomeArquivo: string, anexo?: boolean) => Promise<string>;
  registrarDownload: (registro: RegistroDownload) => Promise<void>;
  hashIp: (request: Request) => string | null;
  agora: () => Date;
};

const CABECALHOS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const base = {
  id: z.uuid(),
  storage_path: z.string().min(1).max(1024).refine((path) =>
    !/[\\%?#\u0000-\u001f\u007f]/.test(path) && path.split("/").every((parte) => parte !== "" && parte !== "." && parte !== "..")),
  mime: z.string().min(1),
};
const documentoSchema = z.object({
  ...base,
  titulo: z.string(),
  liberado_cliente: z.boolean(),
  empreendimento_id: z.uuid(),
  equipamento_papel: z.enum(["simo", "laudo"]).nullish(),
});
const atualizacaoSchema = z.object({
  ...base,
  atualizacoes: z.object({ id: z.uuid(), publicado: z.boolean(), empreendimento_id: z.uuid() }),
});
const relatoSchema = z.object({
  ...base,
  relatos_obra: z.object({
    id: z.uuid(), status: z.enum(["pendente", "aprovado", "devolvido"]),
    obras: z.object({ id: z.uuid() }),
  }),
});
const fornecedorSchema = z.object({ ...base, fornecedor_id: z.uuid() });
// Papéis externos entram sem permissão (a liberação para eles é conferida em validarArquivo); a conta interna precisa do `ver` do módulo dono.
export const REGRA_POR_TIPO: Record<TipoArquivoPrivado, RegraAcesso> = {
  documento: { externos: ["cliente"], interna: "documentos.ver" },
  atualizacao_foto: { externos: ["cliente"], interna: "atualizacoes.ver" },
  relato_foto: { externos: ["cliente", "empreiteiro"], interna: "obras.ver" },
  fornecedor_documento: { externos: ["fornecedor"], interna: "fornecedores.ver" },
  fornecedor_contrato: { externos: ["fornecedor"], interna: "fornecedores.ver" },
};
const CONSULTAS = {
  documento: { tabela: "documentos", campos: "id,storage_path,mime,titulo,liberado_cliente,empreendimento_id,equipamento_papel" },
  atualizacao_foto: { tabela: "atualizacao_fotos", campos: "id,storage_path,mime,atualizacoes!inner(id,publicado,empreendimento_id)" },
  relato_foto: { tabela: "relato_fotos", campos: "id,storage_path,mime,relatos_obra!inner(id,status,obras!inner(id))" },
  fornecedor_documento: { tabela: "fornecedor_documentos", campos: "id,fornecedor_id,storage_path,mime" },
  fornecedor_contrato: { tabela: "fornecedor_contratos", campos: "id,fornecedor_id,storage_path,mime" },
} as const;

function conferirErro(error: unknown): void {
  if (!error) return;
  const campos = z.object({ code: z.string().optional(), status: z.number().optional() }).safeParse(error);
  console.error("[portal] arquivo:", campos.success ? campos.data.code : undefined, campos.success ? campos.data.status : undefined);
  throw new InternalServerError(null);
}

const dependenciasPadrao: DependenciasArquivoPrivado = {
  autorizar: autorizarPortal,
  criarSessao: createClient,
  async assinarUrl(bucket, path, segundos, anexo) {
    const { data, error } = await createAdminClient().storage.from(bucket)
      .createSignedUrl(path, segundos, anexo ? { download: true } : undefined);
    conferirErro(error);
    if (!data?.signedUrl) throw new InternalServerError(null);
    return data.signedUrl;
  },
  assinarUrlDocumento: (path, segundos, nomeArquivo, anexo = true) => presignGet(path, segundos, { nomeArquivo, anexo }),
  async registrarDownload(registro) {
    const { error } = await createAdminClient().from("downloads_log").insert(registro);
    conferirErro(error);
  },
  hashIp: (request) => chaveIp(request, "download")?.replace(/^download:/, "") ?? null,
  agora: () => new Date(),
};

type ArquivoValidado = { path: string; nomeArquivo?: string };

// "visualizar" é do SIMO e do Laudo: o SIMO o cliente só vê no visualizador do site, sem rota para baixar o arquivo.
type Finalidade = "baixar" | "visualizar";

function validarArquivo(dados: unknown, tipo: TipoArquivoPrivado, cliente: boolean, finalidade: Finalidade = "baixar"): ArquivoValidado {
  if (tipo === "fornecedor_documento" || tipo === "fornecedor_contrato") {
    const linha = fornecedorSchema.safeParse(dados);
    if (!linha.success) throw new InternalServerError(null);
    const pasta = tipo === "fornecedor_documento" ? "documentos" : "contratos";
    if (!linha.data.storage_path.startsWith(`${linha.data.fornecedor_id}/${pasta}/`)) throw new NotFoundError();
    return { path: linha.data.storage_path };
  }
  if (tipo === "documento") {
    const linha = documentoSchema.safeParse(dados);
    if (!linha.success) throw new InternalServerError(null);
    const documento = linha.data;
    if (cliente && (!documento.liberado_cliente || documento.mime !== "application/pdf")) throw new NotFoundError();
    const simo = documento.equipamento_papel === "simo";
    // Visualizar serve SIMO e Laudo; baixar serve tudo, menos SIMO para o cliente.
    if (finalidade === "visualizar" ? !documento.equipamento_papel : cliente && simo) throw new NotFoundError();
    if (!documento.storage_path.startsWith(`${documento.empreendimento_id}/`)) throw new NotFoundError();
    return { path: documento.storage_path, nomeArquivo: nomeArquivoPdf(documento.titulo) };
  }
  if (tipo === "atualizacao_foto") {
    const linha = atualizacaoSchema.safeParse(dados);
    if (!linha.success) throw new InternalServerError(null);
    const { atualizacoes: pai, storage_path: path } = linha.data;
    if (cliente && !pai.publicado) throw new NotFoundError();
    if (!path.startsWith(`atualizacoes/${pai.empreendimento_id}/${pai.id}/`)) throw new NotFoundError();
    return { path };
  }
  const linha = relatoSchema.safeParse(dados);
  if (!linha.success) throw new InternalServerError(null);
  const { relatos_obra: pai, storage_path: path } = linha.data;
  if (cliente && pai.status !== "aprovado") throw new NotFoundError();
  if (!path.startsWith(`relatos/${pai.obras.id}/${pai.id}/`)) throw new NotFoundError();
  return { path };
}

// Visualização do SIMO: a mesma autorização, a mesma leitura pela sessão (RLS) e o mesmo registro em downloads_log do
// download, mas devolve a URL assinada (inline, 60 s) em JSON para o visualizador do site buscar o PDF e desenhá-lo.
// Documento que não é SIMO nem Laudo responde o 404 padrão, para equipe e cliente.
export async function entregarVisualizacaoDeSimo(
  request: Request,
  id: UUID,
  dependencias: DependenciasArquivoPrivado = dependenciasPadrao,
): Promise<Response> {
  try {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError();
    const acesso = await dependencias.autorizar("download", REGRA_POR_TIPO.documento);
    const sessao = await dependencias.criarSessao();
    const consulta = CONSULTAS.documento;
    const { data, error } = await sessao.from(consulta.tabela).select(consulta.campos).eq("id", id).maybeSingle();
    conferirErro(error);
    if (data === null) throw new NotFoundError();
    const { path, nomeArquivo } = validarArquivo(data as unknown, "documento", acesso.perfil.papel === "cliente", "visualizar");
    const url = await dependencias.assinarUrlDocumento(path, 60, nomeArquivo ?? "documento.pdf", false);
    if (!["https:", "http:"].includes(new URL(url).protocol)) throw new InternalServerError(null);
    await dependencias.registrarDownload({
      arquivo_tipo: "documento",
      arquivo_id: id,
      profile_id: acesso.user.id,
      ip_hash: dependencias.hashIp(request),
      em: dependencias.agora().toISOString(),
    });
    return Response.json({ url }, { status: 200, headers: CABECALHOS });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      const campos = z.object({ code: z.string().optional(), status: z.number().optional() }).safeParse(error);
      console.error("[portal] visualização:", campos.success ? campos.data.code : undefined, campos.success ? campos.data.status : undefined);
    }
    const { status, message, details } = handleError(error);
    return Response.json({ message, details }, { status, headers: CABECALHOS });
  }
}

export async function entregarArquivoPrivado(
  request: Request,
  tipo: TipoArquivoPrivado,
  id: UUID,
  dependencias: DependenciasArquivoPrivado = dependenciasPadrao,
): Promise<Response> {
  try {
    if (!z.enum(["documento", "atualizacao_foto", "relato_foto", "fornecedor_documento", "fornecedor_contrato"]).safeParse(tipo).success
      || !z.uuid().safeParse(id).success) throw new NotFoundError();
    const anexo = tipo !== "atualizacao_foto" && tipo !== "relato_foto";
    // Foto abre inline na miniatura; com ?baixar=1 ("Baixar original") vai como anexo.
    const baixar = anexo || new URL(request.url).searchParams.get("baixar") === "1";
    const acesso = await dependencias.autorizar(baixar ? "download" : "foto", REGRA_POR_TIPO[tipo]);
    const sessao = await dependencias.criarSessao();
    const consulta = CONSULTAS[tipo];
    const { data, error } = await sessao.from(consulta.tabela).select(consulta.campos).eq("id", id).maybeSingle();
    conferirErro(error);
    if (data === null) throw new NotFoundError();
    const { path, nomeArquivo } = validarArquivo(data as unknown, tipo, acesso.perfil.papel === "cliente");
    const url = nomeArquivo !== undefined
      ? await dependencias.assinarUrlDocumento(path, 60, nomeArquivo)
      : await dependencias.assinarUrl(anexo ? "fornecedores" : "obras", path, 60, baixar);
    const destino = new URL(url);
    if (!["https:", "http:"].includes(destino.protocol)) throw new InternalServerError(null);
    if (baixar) {
      await dependencias.registrarDownload({
        arquivo_tipo: tipo === "atualizacao_foto" || tipo === "relato_foto" ? "foto_obra" : tipo,
        arquivo_id: id,
        profile_id: acesso.user.id,
        ip_hash: dependencias.hashIp(request),
        em: dependencias.agora().toISOString(),
      });
    }
    return new Response(null, { status: 307, headers: { ...CABECALHOS, Location: url } });
  } catch (error) {
    if (!(error instanceof HttpError)) {
      const campos = z.object({ code: z.string().optional(), status: z.number().optional() }).safeParse(error);
      console.error("[portal] entrega:", campos.success ? campos.data.code : undefined, campos.success ? campos.data.status : undefined);
    }
    const { status, message, details } = handleError(error);
    return Response.json({ message, details }, { status, headers: CABECALHOS });
  }
}
