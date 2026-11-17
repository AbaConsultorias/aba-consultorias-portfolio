import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { ConflictError } from '@/app/api/HttpErrors';
import { conferirErro } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
export async function ordenar(entrada: z.infer<typeof schemas.ordenarSchema>) {
 const sessao=await createClient();
 const {error}=await sessao.rpc('reordenar_projetos',{p_empreendimento:entrada.empreendimentoId,p_pai:entrada.projetoPaiId,p_ids:entrada.ids});
 if(error && z.object({code:z.string()}).safeParse(error).data?.code==='22023') throw new ConflictError('A lista de projetos mudou. Atualize a página e tente de novo.');
 conferirErro(error);
 return {total:entrada.ids.length};
}
