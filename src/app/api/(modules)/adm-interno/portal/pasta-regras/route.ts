import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { atualizarSchema, consultaSchema, criarSchema, excluirSchema } from "./schema";
import { atualizar, criar, excluir, listar } from "./service";

export const dynamic = "force-dynamic";

// Regras de pasta do conector: quem tem servidor.regras gerencia, mas a liberação automática e qualquer mudança numa
// regra já ligada são só do admin (o serviço confere). A lista de bloqueio e o destino são conferidos aqui e de novo no banco.
export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "servidor.regras");
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    const details = await listar(entrada);
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function POST(request: Request) {
  try {
    const { perfil } = await autorizarPortal("escrita", "servidor.regras");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: criarSchema });
    const details = await criar(entrada, perfil.papel === "admin");
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const { perfil } = await autorizarPortal("escrita", "servidor.regras");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: atualizarSchema });
    const details = await atualizar(entrada, perfil.papel === "admin");
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(request: Request) {
  try {
    const { perfil } = await autorizarPortal("escrita", "servidor.regras");
    const entrada = validation({ data: await lerJsonLimitado(request, 16 * 1024), schema: excluirSchema });
    const details = await excluir(entrada, perfil.papel === "admin");
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
