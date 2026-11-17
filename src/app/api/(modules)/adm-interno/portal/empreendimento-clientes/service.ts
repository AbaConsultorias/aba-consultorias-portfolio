import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { conferirErro, ler, paginacao, paginaDe } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
const linhaSchema = z.object({ id: z.uuid(), empreendimento_id:z.uuid(), profile_id:z.uuid(), profiles:z.object({nome:z.string()}) });
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
 const sessao = await createClient(); const { inicio, pagina, limite } = paginacao(entrada);
 let query = sessao.from('empreendimento_clientes').select('id,empreendimento_id,profile_id,profiles!inner(nome)').order('criado_em').order('id').range(inicio, inicio + limite);
 query=query.eq('empreendimento_id',entrada.empreendimentoId);
 const {data,error}=await query; conferirErro(error);
 return paginaDe(ler(linhaSchema.array(),data as unknown),pagina,limite);
}
export async function criar(entrada: z.infer<typeof schemas.criarSchema>) {
 const sessao=await createClient(); const {data,error}=await sessao.from('empreendimento_clientes').insert({empreendimento_id:entrada.empreendimentoId,profile_id:entrada.profileId}).select('id').single(); conferirErro(error); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function excluir({id}: z.infer<typeof schemas.excluirSchema>) {
 const sessao=await createClient();
 
 const {error}=await sessao.from('empreendimento_clientes').delete().eq('id',id); conferirErro(error); return {id};
}
