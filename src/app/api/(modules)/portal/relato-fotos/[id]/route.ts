import { validation } from '@/app/api/utils/validation';
import { handleResponse } from '@/app/api/utils/handleResponse';
import { handleError } from '@/app/api/utils/handleError';
import { exigirRegraApi } from '@/lib/auth/permissoes-servidor';
import { REGRA_POR_TIPO } from '@/lib/portal/comum/arquivos';
import { consultaSchema } from './schema';
import { obter } from './service';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{ await exigirRegraApi(REGRA_POR_TIPO.relato_foto); const {id}=validation({data:await params,schema:consultaSchema});return await obter(request,id); }
 catch(error){const resposta=handleResponse(handleError(error));resposta.headers.set('Cache-Control','private, no-store');resposta.headers.set('Referrer-Policy','no-referrer');return resposta;}
}
