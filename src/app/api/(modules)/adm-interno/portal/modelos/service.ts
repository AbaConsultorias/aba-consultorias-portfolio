import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { ConflictError, } from '@/app/api/HttpErrors';
import { conferirErro, ler, paginacao, paginaDe } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
const linhaSchema = z.object({ id: z.uuid(), nome:z.string(), descricao:z.string().nullable(), ativo:z.boolean(), modelo_etapas_itens:z.object({id:z.uuid(),nome:z.string(),ordem:z.number().int(),marco:z.enum(schemas.MARCOS_DE_ETAPA).nullable()}).array(), modelo_categorias_documento:z.object({id:z.uuid(),nome:z.string(),ordem:z.number().int()}).array() });
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
 const sessao = await createClient(); const { inicio, pagina, limite } = paginacao(entrada);
 let query = sessao.from('modelos_etapas').select('id,nome,descricao,ativo,modelo_etapas_itens(id,nome,ordem,marco),modelo_categorias_documento(id,nome,ordem)').order('nome').order('id').range(inicio, inicio + limite);
 if(entrada.id) query=query.eq('id',entrada.id);
 const {data,error}=await query; conferirErro(error);
 return paginaDe(ler(linhaSchema.array(),data as unknown),pagina,limite);
}
async function salvar(entrada:z.infer<typeof schemas.criarSchema>,id:string|null){
 const sessao=await createClient(); const {data,error}=await sessao.rpc('salvar_modelo_portal',{p_id:id,p_nome:entrada.nome,p_descricao:entrada.descricao,p_ativo:entrada.ativo,p_etapas:entrada.etapas,p_categorias:entrada.categorias}); conferirErro(error); return {id:ler(z.uuid(),data as unknown)};
}
export async function criar(entrada:z.infer<typeof schemas.criarSchema>){return salvar(entrada,null);}
export async function atualizar(entrada:z.infer<typeof schemas.atualizarSchema>){return salvar(entrada,entrada.id);}
export async function excluir({id}: z.infer<typeof schemas.excluirSchema>) {
 const sessao=await createClient();
 { const {data,error}=await sessao.from('projetos').select('id').eq('modelo_origem_id',id).limit(1); conferirErro(error); if(data?.length) throw new ConflictError('Remova os registros vinculados antes de excluir.'); }
 const {error}=await sessao.from('modelos_etapas').delete().eq('id',id); conferirErro(error); return {id};
}
