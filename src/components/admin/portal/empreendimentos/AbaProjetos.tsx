import { opcoes, projetosEmOrdem } from "@/lib/portal/andamento/admin";
import { contarPorColuna, nomesPorId } from "@/lib/portal/empreendimentos/indicadores";
import { sugestoesDaPagina } from "@/app/api/(modules)/adm-interno/portal/etapas-automaticas/service";
import { listar as listarProjetos } from "@/app/api/(modules)/adm-interno/portal/projetos/service";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import { idsDosIrmaos, montarArvore, type ProjetoLinha } from "./arvore";
import { SecaoProjetos } from "./SecaoProjetos";

// Só a página chama este componente, depois de conferir empreendimentos.ver; documentos.ver decide se há contagem de documentos.
export async function AbaProjetos({ adminPath, empreendimentoId, base, pagina, podeEditar, verDocumentos }: {
  adminPath: string; empreendimentoId: string; base: string; pagina: number; podeEditar: boolean; verDocumentos: boolean;
}) {
  const [projetos, modelos, todosOsProjetos, emOrdem] = await Promise.all([
    listarProjetos({ pagina, limite: 100, empreendimentoId }),
    podeEditar ? opcoes("modelos_etapas") : [],
    opcoes("projetos", empreendimentoId),
    projetosEmOrdem(empreendimentoId),
  ]);
  const irmaosPorPai = idsDosIrmaos(emOrdem);
  const ids = projetos.registros.map((projeto) => projeto.id);
  const [etapas, modelosPorId, documentos, sugestoes] = await Promise.all([
    nomesPorId("projeto_etapas", projetos.registros.flatMap((projeto) => projeto.etapa_atual_id ?? [])),
    nomesPorId("modelos_etapas", projetos.registros.flatMap((projeto) => projeto.modelo_origem_id ?? [])),
    verDocumentos ? contarPorColuna({ tabela: "documentos", coluna: "projeto_id", ids }) : undefined,
    sugestoesDaPagina(empreendimentoId, ids),
  ]);
  const nomeDoProjeto = new Map(todosOsProjetos.map(({ valor, nome }) => [valor, nome]));
  const naPagina = new Set(ids);
  const linhas: ProjetoLinha[] = projetos.registros.map((projeto) => ({
    id: projeto.id,
    nome: projeto.nome,
    projetoPaiId: projeto.projeto_pai_id,
    ordem: projeto.ordem,
    irmaos: irmaosPorPai.get(projeto.projeto_pai_id) ?? [],
    nomePaiForaDaPagina: projeto.projeto_pai_id && !naPagina.has(projeto.projeto_pai_id) ? nomeDoProjeto.get(projeto.projeto_pai_id) ?? null : null,
    modeloNome: projeto.modelo_origem_id ? modelosPorId?.get(projeto.modelo_origem_id) ?? null : null,
    etapaNome: projeto.etapa_atual_id ? etapas?.get(projeto.etapa_atual_id) ?? null : null,
    temEtapaAtual: projeto.etapa_atual_id !== null,
    documentos: documentos === undefined ? undefined : documentos ? documentos.get(projeto.id) ?? 0 : null,
    sugestao: sugestoes.get(projeto.id),
  }));
  return (
    <>
      <SecaoProjetos adminPath={adminPath} empreendimentoId={empreendimentoId} arvore={montarArvore(linhas)} total={linhas.length} podeEditar={podeEditar} opcoesModelo={modelos} opcoesPai={todosOsProjetos} />
      <Paginacao pagina={pagina} proxima={projetos.proximaPagina} parametro="paginaProjetos" base={`${base}?aba=projetos`} />
    </>
  );
}
