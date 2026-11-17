import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { ConflictError, NotFoundError } from '@/app/api/HttpErrors';
import { conferirErro, ler, paginacao, paginaDe } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
const linhaSchema = z.object({ id: z.uuid(), nome:z.string(), empreendimento_id:z.uuid(), modelo_origem_id:z.uuid().nullable(), etapa_atual_id:z.uuid().nullable(), projeto_pai_id:z.uuid().nullable(), ordem:z.number().int().min(0) });
// Mensagens da trigger validar_hierarquia_projetos: só estas voltam ao usuário; o restante do 23514 segue genérico.
const MENSAGENS_HIERARQUIA = new Set([
 'Um projeto não pode depender de si mesmo.',
 'O projeto do qual este depende não existe.',
 'O projeto do qual este depende precisa ser do mesmo empreendimento.',
 'Esta dependência criaria um ciclo entre projetos.',
 'A cadeia de dependências entre projetos é longa demais.',
]);
function conferirHierarquia(error: unknown) {
 const erro = z.object({ code: z.string(), message: z.string() }).safeParse(error);
 if (erro.success && erro.data.code === '23514' && MENSAGENS_HIERARQUIA.has(erro.data.message)) throw new ConflictError(erro.data.message);
 if (erro.success && (erro.data.code === '40P01' || erro.data.code === '40001')) throw new ConflictError('Outra alteração estava em andamento; tente de novo.');
 conferirErro(error);
}
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
 const sessao = await createClient(); const { inicio, pagina, limite } = paginacao(entrada);
 let query = sessao.from('projetos').select('id,nome,empreendimento_id,modelo_origem_id,etapa_atual_id,projeto_pai_id,ordem').order('ordem').order('nome').order('id').range(inicio, inicio + limite);
 if(entrada.id) query=query.eq('id',entrada.id); if(entrada.empreendimentoId) query=query.eq('empreendimento_id',entrada.empreendimentoId);
 const {data,error}=await query; conferirErro(error);
 return paginaDe(ler(linhaSchema.array(),data as unknown),pagina,limite);
}
export async function criar(entrada:z.infer<typeof schemas.criarSchema>){
 const sessao=await createClient(); const {data: modelo,error: erroModelo}=await sessao.from('modelos_etapas').select('id').eq('id',entrada.modeloId).eq('ativo',true).maybeSingle(); conferirErro(erroModelo); if(!modelo) throw new ConflictError('Escolha um modelo ativo.');
 if(entrada.projetoPaiId){ const {data: pai,error: erroPai}=await sessao.from('projetos').select('id').eq('id',entrada.projetoPaiId).eq('empreendimento_id',entrada.empreendimentoId).maybeSingle(); conferirErro(erroPai); if(!pai) throw new ConflictError('O projeto do qual este depende precisa ser do mesmo empreendimento.'); }
 const {data,error}=await sessao.rpc('criar_projeto_de_modelo',{p_empreendimento:entrada.empreendimentoId,p_modelo:entrada.modeloId,p_nome:entrada.nome,p_projeto_pai:entrada.projetoPaiId??null}); conferirHierarquia(error); const id=ler(z.uuid(),data as unknown);
 return {id};
}
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>) {
 const sessao=await createClient();
 const {data,error}=await sessao.from('projetos').update({nome:entrada.nome,...(entrada.projetoPaiId!==undefined?{projeto_pai_id:entrada.projetoPaiId}:{})}).eq('id',entrada.id).select('id').maybeSingle();
 conferirHierarquia(error); if(!data) throw new NotFoundError(); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function excluir({id}: z.infer<typeof schemas.excluirSchema>) {
 const sessao=await createClient();
 { const {data,error}=await sessao.rpc('projeto_tem_vinculos',{p_projeto_id:id}); conferirErro(error); if(ler(z.boolean(),data as unknown)) throw new ConflictError('Remova os registros vinculados antes de excluir.'); }
 const {error}=await sessao.from('projetos').delete().eq('id',id); conferirErro(error); return {id};
}
