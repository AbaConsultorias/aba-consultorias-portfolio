import { lerJsonLimitado } from '@/app/api/utils/corpo';
import { validation } from '@/app/api/utils/validation';
import { handleResponse } from '@/app/api/utils/handleResponse';
import { handleError } from '@/app/api/utils/handleError';
import { autorizarPortal, invalidarPortal } from '@/lib/portal/comum/servidor';
import { ordenarSchema } from './schema';
import { ordenar } from './service';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    await autorizarPortal('escrita', 'empreendimentos.editar');
    const entrada = validation({ data: await lerJsonLimitado(request, 8 * 1024), schema: ordenarSchema });
    const details = await ordenar(entrada);
    invalidarPortal();
    return handleResponse({ message: 'Alteração salva.', details, status: 200 });
  } catch (error) { return handleResponse(handleError(error)); }
}
