import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { consultaSchema, montarSchema } from "./schema";
import { montar, previaDaMontagem } from "./service";

export const dynamic = "force-dynamic";

// Pré-visualização de "Montar a partir do servidor": só lê. A lista de complementares só vem com a chave ligada.
export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "servidor.regras");
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    const details = await previaDaMontagem(entrada);
    return handleResponse({ message: "Consulta realizada.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

// RegraAcesso não tem "todas as permissões": a rota pede empreendimentos.editar e o serviço confere servidor.regras
// (o banco confere as duas de novo dentro da função).
export async function POST(request: Request) {
  try {
    const acesso = await autorizarPortal("escrita", "empreendimentos.editar");
    const entrada = validation({ data: await lerJsonLimitado(request, 32 * 1024), schema: montarSchema });
    const details = await montar(entrada, acesso.permissoes);
    invalidarPortal();
    return handleResponse({ message: "Alteração salva.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
