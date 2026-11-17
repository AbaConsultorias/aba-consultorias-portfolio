import { BadRequestError, PayloadTooLargeError } from "@/app/api/HttpErrors";
import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarConteudo } from "@/components/admin/conteudo/servidor";
import { apagarArquivoSchema, mapaSchema } from "./schema";
import { apagarArquivo, enviarMapa, exigirLimiteDeEnvio, LIMITES_BYTES } from "./service";

// Margem para os campos e as bordas do multipart; o limite exato do arquivo
// é conferido no service. Recusar pelo cabeçalho evita ler um corpo enorme.
const MARGEM_MULTIPART = 512 * 1024;
const MAIOR_CORPO = LIMITES_BYTES.mapa + MARGEM_MULTIPART;

function campoTexto(form: FormData, nome: string) {
  const valor = form.get(nome);
  return typeof valor === "string" && valor !== "" ? valor : undefined;
}

// Só o mapa SVG passa por aqui; imagens e vídeos usam upload/assinar e
// upload/confirmar (o corpo de uma função na Vercel não passa de 4,5 MB).
export async function POST(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");
    await exigirLimiteDeEnvio(user.id);

    const tamanho = Number(request.headers.get("content-length"));
    if (!Number.isFinite(tamanho) || tamanho <= 0) {
      throw new BadRequestError("Envio inválido.");
    }
    if (tamanho > MAIOR_CORPO) {
      throw new PayloadTooLargeError("O arquivo é grande demais.");
    }

    const form = await request.formData().catch(() => null);
    if (!form) throw new BadRequestError("Envio inválido.");

    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) throw new BadRequestError("Selecione um arquivo.");

    const data = validation({
      data: {
        destino: campoTexto(form, "destino"),
        donoId: campoTexto(form, "donoId"),
        tipo: campoTexto(form, "tipo"),
      },
      schema: mapaSchema,
    });

    const resultado = await enviarMapa(data, arquivo);

    return handleResponse({
      message: "Arquivo enviado com sucesso.",
      details: resultado,
      status: 201,
    });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await autorizarConteudo("site.editar");

    const body = await lerJsonLimitado(request, 12 * 1024);
    const data = validation({ data: body, schema: apagarArquivoSchema });

    await apagarArquivo(data, user.id);

    return handleResponse({ message: "Arquivo apagado com sucesso.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
