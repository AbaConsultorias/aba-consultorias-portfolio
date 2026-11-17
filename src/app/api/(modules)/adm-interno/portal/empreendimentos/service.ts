import "server-only";
import z from "zod";
import { createClient } from '@/lib/supabase/server';
import { ConflictError, ForbiddenError, NotFoundError } from '@/app/api/HttpErrors';
import type { Papel } from '@/lib/auth/papeis';
import type { Permissao } from '@/lib/auth/permissoes';
import { conferirErro, ler, paginacao, paginaDe } from '@/lib/portal/andamento/servidor';
import * as schemas from './schema';
const linhaSchema = z.object({ id: z.uuid(), nome:z.string(), cidade:z.string().nullable(), descricao:z.string().nullable(), situacao:z.enum(['ativo','concluido','arquivado']), loteamento_id:z.uuid().nullable(), codigo_pasta:z.string().nullable().optional(), liberacao_automatica:z.boolean().optional() });
const estadoPastaSchema = z.object({ codigo_pasta:z.string().nullable(), liberacao_automatica:z.boolean() });
const COLUNAS = 'id,nome,cidade,descricao,situacao,loteamento_id';
export type PermissoesDaPasta = { ehAdmin: boolean; podeRegras: boolean };
export function permissoesDaPasta(acesso: { perfil: { papel: Papel }; permissoes: ReadonlySet<Permissao> }): PermissoesDaPasta {
 const ehAdmin = acesso.perfil.papel === 'admin';
 return { ehAdmin, podeRegras: ehAdmin || acesso.permissoes.has('servidor.regras') };
}
// 23505 genérico do conferirErro diria só "já cadastrado": para o código da pasta a pessoa precisa saber qual campo repetiu.
function conferirCodigoPastaDuplicado(error: unknown) {
 const erro = z.object({ code: z.string(), message: z.string().optional(), details: z.string().nullish() }).safeParse(error);
 if (erro.success && erro.data.code === '23505' && `${erro.data.message ?? ''} ${erro.data.details ?? ''}`.includes('codigo_pasta')) throw new ConflictError('Este código de pasta já está em uso por outro empreendimento.');
}
// Sem servidor.regras (nem admin) os dois campos da pasta nem saem do banco: a consulta não os pede.
export async function listar(entrada: z.infer<typeof schemas.consultaSchema>, podeVerPasta: boolean) {
 const sessao = await createClient(); const { inicio, pagina, limite } = paginacao(entrada);
 let query = sessao.from('empreendimentos').select(podeVerPasta ? `${COLUNAS},codigo_pasta,liberacao_automatica` : COLUNAS).order('nome').order('id').range(inicio, inicio + limite);
 if(entrada.id) query=query.eq('id',entrada.id);
 const {data,error}=await query; conferirErro(error);
 return paginaDe(ler(linhaSchema.array(),data as unknown),pagina,limite);
}
export async function criar(entrada: z.infer<typeof schemas.criarSchema>) {
 const sessao=await createClient(); const {data,error}=await sessao.from('empreendimentos').insert({nome:entrada.nome,cidade:entrada.cidade,descricao:entrada.descricao,situacao:entrada.situacao,loteamento_id:entrada.loteamentoId}).select('id').single(); conferirErro(error); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>, pasta: PermissoesDaPasta) {
 const sessao=await createClient();
 const {data: atual,error: erroAtual}=await sessao.from('empreendimentos').select('codigo_pasta,liberacao_automatica').eq('id',entrada.id).maybeSingle();
 conferirErro(erroAtual); if(!atual) throw new NotFoundError();
 const {codigo_pasta: codigoAtual,liberacao_automatica: liberacaoAtual}=ler(estadoPastaSchema,atual as unknown);
 const mudaCodigo=entrada.codigoPasta!==undefined&&entrada.codigoPasta!==codigoAtual;
 const mudaLiberacao=entrada.liberacaoAutomatica!==undefined&&entrada.liberacaoAutomatica!==liberacaoAtual;
 if(mudaLiberacao&&!pasta.ehAdmin) throw new ForbiddenError('Só o administrador altera a liberação automática.');
 if(mudaCodigo&&!pasta.podeRegras) throw new ForbiddenError('Acesso negado.');
 // Quem não é admin só chega aqui com a liberação igual à atual, então ligada antes e ligada depois são a mesma coisa.
 if(mudaCodigo&&!pasta.ehAdmin&&liberacaoAtual) throw new ForbiddenError('Com a liberação automática ligada, só o administrador altera o código da pasta.');
 const {data,error}=await sessao.from('empreendimentos').update({nome:entrada.nome,cidade:entrada.cidade,descricao:entrada.descricao,situacao:entrada.situacao,loteamento_id:entrada.loteamentoId,...(mudaCodigo?{codigo_pasta:entrada.codigoPasta}:{}),...(mudaLiberacao?{liberacao_automatica:entrada.liberacaoAutomatica}:{})}).eq('id',entrada.id).select('id').maybeSingle();
 conferirCodigoPastaDuplicado(error); conferirErro(error); if(!data) throw new NotFoundError(); return ler(z.object({id:z.uuid()}),data as unknown);
}
export async function excluir({id}: z.infer<typeof schemas.excluirSchema>) {
 const sessao=await createClient();
 // Quem exclui pode não enxergar documentos, atualizações ou obras: sob RLS a checagem pela sessão voltaria vazia e o DELETE apagaria em cascata o que a pessoa não vê.
 { const {data,error}=await sessao.rpc('empreendimento_tem_vinculos',{p_empreendimento_id:id}); conferirErro(error); if(ler(z.boolean(),data as unknown)) throw new ConflictError('Remova os registros vinculados antes de excluir.'); }
 const {error}=await sessao.from('empreendimentos').delete().eq('id',id); conferirErro(error); return {id};
}
