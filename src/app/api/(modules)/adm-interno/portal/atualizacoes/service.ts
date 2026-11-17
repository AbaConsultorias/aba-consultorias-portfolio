import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { ConflictError, NotFoundError } from '@/app/api/HttpErrors';
import { conferirErro, ler, paginacao, paginaDe } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
const linhaSchema = z.object({ id: z.uuid(), titulo:z.string(), texto:z.string().nullable(), empreendimento_id:z.uuid(), projeto_id:z.uuid().nullable(), etapa_id:z.uuid().nullable(), data_visita:z.iso.date().nullable(), publicado:z.boolean() });
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
 const sessao = await createClient(); const { inicio, pagina, limite } = paginacao(entrada);
 let query = sessao.from('atualizacoes').select('id,titulo,texto,empreendimento_id,projeto_id,etapa_id,data_visita,publicado').order('criado_em',{ascending:false}).order('id').range(inicio, inicio + limite);
 if(entrada.id) query=query.eq('id',entrada.id); if(entrada.empreendimentoId) query=query.eq('empreendimento_id',entrada.empreendimentoId);
 const {data,error}=await query; conferirErro(error);
 return paginaDe(ler(linhaSchema.array(),data as unknown),pagina,limite);
}
export async function criar(entrada: z.infer<typeof schemas.criarSchema>) {
 const sessao=await createClient(); const {data,error}=await sessao.from('atualizacoes').insert({titulo:entrada.titulo,texto:entrada.texto,empreendimento_id:entrada.empreendimentoId,projeto_id:entrada.projetoId,etapa_id:entrada.etapaId,data_visita:entrada.dataVisita,publicado:false}).select('id').single(); conferirErro(error); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>) {
 const sessao=await createClient();
 const {data,error}=await sessao.from('atualizacoes').update({titulo:entrada.titulo,texto:entrada.texto,projeto_id:entrada.projetoId,etapa_id:entrada.etapaId,data_visita:entrada.dataVisita,publicado:entrada.publicado}).eq('id',entrada.id).select('id').maybeSingle();
 conferirErro(error); if(!data) throw new NotFoundError(); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function excluir({id}: z.infer<typeof schemas.excluirSchema>) {
 const sessao=await createClient();
 { const {data,error}=await sessao.from('atualizacao_fotos').select('id').eq('atualizacao_id',id).limit(1); conferirErro(error); if(data?.length) throw new ConflictError('Remova os registros vinculados antes de excluir.'); }
 const {error}=await sessao.from('atualizacoes').delete().eq('id',id); conferirErro(error); return {id};
}
