import z from "zod";
import { assinarSchema } from "@/app/api/(modules)/adm-interno/portal/atualizacao-fotos/upload/schema";

export const TIPOS_FOTO = [...assinarSchema.shape.mime.options, ".heic", ".heif"].join(",");
export type EstadoFoto = "aguardando" | "autorizando" | "enviando" | "confirmando" | "concluida" | "erro";
export type FotoSelecionada = { id: string; arquivo: File; estado: EstadoFoto; comprovante?: string; erro?: string };
class ErroUploadFoto extends Error {
  constructor(mensagem: string, readonly status?: number) {
    super(mensagem);
  }
}

export function mensagemErroFoto(erro: unknown): string {
  return erro instanceof ErroUploadFoto ? erro.message : "Não foi possível concluir o envio. Confira a conexão e tente novamente.";
}

// Alguns sistemas deixam o MIME vazio para HEIC/HEIF; o servidor confere os bytes reais.
export function mimeDoArquivo(arquivo: File | null): string {
  const extensoes: Record<string, string> = { heic: "image/heic", heif: "image/heif" };
  return arquivo?.type || extensoes[arquivo?.name.split(".").pop()?.toLowerCase() ?? ""] || "";
}

export function erroDoArquivo(arquivo: File): string | null {
  if (!assinarSchema.shape.mime.safeParse(mimeDoArquivo(arquivo)).success) return "Use JPEG, PNG, WebP, HEIC ou HEIF.";
  if (!assinarSchema.shape.tamanho.safeParse(arquivo.size).success) return "A foto deve ter entre 1 byte e 10 MiB.";
  return null;
}

export async function confirmarFoto(endpoint: string, comprovante: string) {
  const resposta = await fetch(`${endpoint}/upload/confirmar`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comprovante }),
  });
  if (!resposta.ok) throw new ErroUploadFoto("Não foi possível confirmar a foto. Tente novamente ou revise em Fotos depois.", resposta.status);
  return z.object({ details: z.object({ id: z.uuid() }) }).parse(await resposta.json()).details.id;
}

export async function enviarFoto({ endpoint, entrada, arquivo, comprovante, aoComprovante, aoEstado }: {
  endpoint: string; entrada: z.infer<typeof assinarSchema>; arquivo: File; comprovante?: string;
  aoComprovante: (valor: string) => void; aoEstado?: (estado: EstadoFoto) => void;
}) {
  let token = comprovante;
  if (!token) {
    const dados = assinarSchema.parse(entrada);
    aoEstado?.("autorizando");
    const resposta = await fetch(`${endpoint}/upload/assinar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados),
    });
    if (!resposta.ok) throw new ErroUploadFoto("Não foi possível autorizar o envio. Tente novamente mais tarde.");
    const assinatura = z.object({ details: z.object({ signedUrl: z.url(), comprovante: z.string().min(1) }) }).parse(await resposta.json());
    aoEstado?.("enviando");
    const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const envio = await fetch(assinatura.details.signedUrl, {
      method: "PUT", headers: { "Content-Type": dados.mime, "x-upsert": "false", "cache-control": "max-age=3600", ...(chave ? { apikey: chave } : {}) }, body: arquivo,
    });
    if (!envio.ok) throw new ErroUploadFoto("Falha ao enviar a foto. Tente novamente.");
    token = assinatura.details.comprovante;
    aoComprovante(token);
  }
  aoEstado?.("confirmando");
  await confirmarFoto(endpoint, token);
  aoEstado?.("concluida");
}

export async function alterarPublicacao(endpoint: string, id: string, publicado: boolean) {
  const resposta = await fetch(endpoint, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, publicado }),
  });
  if (!resposta.ok) throw new Error("Não foi possível alterar a publicação. Confira a situação na lista e tente novamente.");
}

export async function enviarFotosEPublicar({ endpoint, endpointFotos, atualizacaoId, fotos, publicar, aoAlterar }: {
  endpoint: string; endpointFotos: string; atualizacaoId: string; fotos: FotoSelecionada[]; publicar: boolean;
  aoAlterar: (id: string, alteracao: Partial<FotoSelecionada>) => void;
}) {
  const falhas: string[] = [];
  for (const [ordem, foto] of fotos.entries()) {
    if (foto.estado === "concluida") continue;
    try {
      await enviarFoto({
        endpoint: endpointFotos, arquivo: foto.arquivo, comprovante: foto.comprovante,
        entrada: assinarSchema.parse({ atualizacaoId, ordem, mime: mimeDoArquivo(foto.arquivo), tamanho: foto.arquivo.size }),
        aoComprovante: (comprovante) => aoAlterar(foto.id, { comprovante }),
        aoEstado: (estado) => aoAlterar(foto.id, { estado, erro: undefined }),
      });
    } catch (erro) {
      falhas.push(foto.arquivo.name);
      const reassinar = erro instanceof ErroUploadFoto && erro.status !== undefined && erro.status >= 400 && erro.status < 500;
      aoAlterar(foto.id, { estado: "erro", erro: mensagemErroFoto(erro), ...(reassinar ? { comprovante: undefined } : {}) });
    }
  }
  if (!falhas.length && publicar) await alterarPublicacao(endpoint, atualizacaoId, true);
  return falhas;
}
