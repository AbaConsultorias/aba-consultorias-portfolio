import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { NotFoundError } from '@/app/api/HttpErrors';
import { conferirErro, ler, paginacao, paginaDe } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
import { createAdminClient } from '@/lib/supabase/admin';
const linhaSchema = z.object({ id: z.uuid(), mime:z.string(), ordem:z.number().int(), atualizacao_id:z.uuid() });
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
 const sessao = await createClient(); const { inicio, pagina, limite } = paginacao(entrada);
 let query = sessao.from('atualizacao_fotos').select('id,mime,ordem,atualizacao_id').order('ordem').order('id').range(inicio, inicio + limite);
 query=query.eq('atualizacao_id',entrada.atualizacaoId);
 const {data,error}=await query; conferirErro(error);
 return paginaDe(ler(linhaSchema.array(),data as unknown),pagina,limite);
}
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>) {
 const sessao=await createClient();
 const {data,error}=await sessao.from('atualizacao_fotos').update({ordem:entrada.ordem}).eq('id',entrada.id).select('id').maybeSingle();
 conferirErro(error); if(!data) throw new NotFoundError(); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function excluir({id}:z.infer<typeof schemas.excluirSchema>){
 const sessao=await createClient();
 const {data,error}=await sessao.from('atualizacao_fotos').select('id,atualizacao_id,storage_path,atualizacoes!inner(id)').eq('id',id).maybeSingle(); conferirErro(error); if(!data) return {id};
 const foto=ler(z.object({id:z.uuid(),atualizacao_id:z.uuid(),storage_path:z.string(),atualizacoes:z.object({id:z.uuid()})}),data as unknown);
 const ocultar=await sessao.from('atualizacoes').update({publicado:false}).eq('id',foto.atualizacao_id).select('id').maybeSingle(); conferirErro(ocultar.error); if(!ocultar.data) throw new NotFoundError();
 const remover=await createAdminClient().storage.from('obras').remove([foto.storage_path]); conferirErro(remover.error);
 const apagar=await sessao.from('atualizacao_fotos').delete().eq('id',id); conferirErro(apagar.error); return {id};
}
