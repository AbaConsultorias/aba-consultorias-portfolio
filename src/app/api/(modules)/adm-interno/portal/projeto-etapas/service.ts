import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { NotFoundError } from '@/app/api/HttpErrors';
import { conferirErro, ler, } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
export async function listar({id}:z.infer<typeof schemas.consultaSchema>){
 const sessao=await createClient(); const {data,error}=await sessao.from('projetos').select('id,etapa_atual_id,projeto_etapas!projeto_etapas_projeto_id_fkey(id,nome,ordem,concluida_em),projeto_categorias_documento(id,nome,ordem)').eq('id',id).maybeSingle(); conferirErro(error); if(!data) throw new NotFoundError();
 return ler(z.object({id:z.uuid(),etapa_atual_id:z.uuid().nullable(),projeto_etapas:z.object({id:z.uuid(),nome:z.string(),ordem:z.number().int(),concluida_em:z.iso.date().nullable()}).array(),projeto_categorias_documento:z.object({id:z.uuid(),nome:z.string(),ordem:z.number().int()}).array()}),data as unknown);
}
export async function atualizar(entrada:z.infer<typeof schemas.atualizarSchema>){
 const sessao=await createClient(); const {error}=await sessao.rpc('salvar_etapas_projeto_portal',{p_projeto:entrada.id,p_etapa_atual:entrada.etapaAtualId,p_etapas:entrada.etapas,p_categorias:entrada.categorias}); conferirErro(error); return {id:entrada.id};
}
