import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { consultaSchema, desfazerSchema, marcarSchema } from "./schema";
import { desfazer, listar, marcar } from "./service";

export async function GET(request: Request) {
  try {
    await autorizarPortal("leitura", "financeiro.ver");
    const consulta = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    return handleResponse({ message: "Eventos carregados.", details: await listar(consulta), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const data = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: marcarSchema });
    const details = await marcar(data);
    invalidarPortal();
    return handleResponse({ message: "Evento marcado.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE(request: Request) {
  try {
    await autorizarPortal("escrita", "financeiro.editar");
    const { id } = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: desfazerSchema });
    const details = await desfazer(id);
    invalidarPortal();
    return handleResponse({ message: "Evento desfeito.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
