import { validation } from '@/app/api/utils/validation';
import { handleResponse } from '@/app/api/utils/handleResponse';
import { handleError } from '@/app/api/utils/handleError';
import { lerJsonLimitado } from '@/app/api/utils/corpo';
import { autorizarPortal, invalidarPortal } from '@/lib/portal/comum/servidor';
import { confirmarSchema } from '../schema';
import { confirmar } from '../service';
export async function POST(request:Request){try{
 const acesso=await autorizarPortal('confirmar', 'atualizacoes.editar');
 const entrada=validation({data:await lerJsonLimitado(request,8*1024),schema:confirmarSchema});
 const details=await confirmar(entrada,acesso.user.id); invalidarPortal();
 return handleResponse({message:'Foto confirmada.',details,status:200});
}catch(error){return handleResponse(handleError(error));}}
