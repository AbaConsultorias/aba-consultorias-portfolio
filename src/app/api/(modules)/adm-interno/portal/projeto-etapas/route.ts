import { lerJsonLimitado } from '@/app/api/utils/corpo';
import { validation } from '@/app/api/utils/validation';
import { handleResponse } from '@/app/api/utils/handleResponse';
import { handleError } from '@/app/api/utils/handleError';
import { autorizarPortal, invalidarPortal } from '@/lib/portal/comum/servidor';
import { consultaSchema, atualizarSchema } from './schema';
import { listar, atualizar } from './service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await autorizarPortal('leitura', 'empreendimentos.ver');
    const entrada = validation({ data: Object.fromEntries(new URL(request.url).searchParams), schema: consultaSchema });
    const details = await listar(entrada);
    return handleResponse({ message: 'Consulta realizada.', details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
export async function PATCH(request: Request) {
  try {
    await autorizarPortal('escrita', 'empreendimentos.editar');
    const entrada = validation({ data: await lerJsonLimitado(request, 32 * 1024), schema: atualizarSchema });
    const details = await atualizar(entrada);
    invalidarPortal();
    return handleResponse({ message: 'Alteração salva.', details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}