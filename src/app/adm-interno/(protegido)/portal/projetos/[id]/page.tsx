import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import z from "zod";
import { prepararAdminComRegra, opcoes, numeroPagina } from "@/lib/portal/andamento/admin";
import { calcularProgresso } from "@/lib/portal/andamento/regras";
import { listar as listarProjetos } from "@/app/api/(modules)/adm-interno/portal/projetos/service";
import { listar as listarEtapas } from "@/app/api/(modules)/adm-interno/portal/projeto-etapas/service";
import { etapasDoProjeto } from "@/app/api/(modules)/adm-interno/portal/etapas-automaticas/service";
import { Gestor } from "@/components/admin/portal/andamento/Gestor";
import { SecaoEtapasDoProjeto } from "@/components/admin/portal/etapas/SecaoEtapasDoProjeto";
import { ListaDocumentosAdmin } from "@/components/admin/portal/documentos/ListaDocumentosAdmin";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { Button } from "@/components/ui/button";
import { listarDocumentosAdmin, listarEstruturaDocumentos } from "@/lib/portal/documentos/consultas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projeto", robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { adminPath, perfil, permissoes } = await prepararAdminComRegra("empreendimentos.ver");
  const somenteLeitura = !permissoes.has("empreendimentos.editar");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const encontrados = await listarProjetos({ pagina: 1, limite: 1, id });
  const projeto = encontrados.registros[0];
  if (!projeto) notFound();
  const detalhe = await listarEtapas({ id });
  const etapas = detalhe.projeto_etapas.map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem, concluidaEm: e.concluida_em }));
  let progresso: number | null;
  try { progresso = calcularProgresso(etapas, detalhe.etapa_atual_id); } catch { progresso = null; }
  const projetosDoEmpreendimento = await opcoes("projetos", projeto.empreendimento_id);
  const pai = projeto.projeto_pai_id && projeto.projeto_pai_id !== projeto.id ? projetosDoEmpreendimento.find((opcao) => opcao.valor === projeto.projeto_pai_id) : undefined;
  let paiPendente = false;
  if (pai) {
    try {
      const detalhePai = await listarEtapas({ id: pai.valor });
      const etapasPai = detalhePai.projeto_etapas.map((e) => ({ id: e.id, nome: e.nome, ordem: e.ordem, concluidaEm: e.concluida_em }));
      paiPendente = etapasPai.length > 0 && detalhePai.etapa_atual_id !== null && calcularProgresso(etapasPai, detalhePai.etapa_atual_id) < 100;
    } catch { paiPendente = false; }
  }
  const podeVerDocumentos = permissoes.has("documentos.ver");
  const pagina = numeroPagina((await searchParams).pagina);
  const [documentos, estrutura] = podeVerDocumentos
    ? await Promise.all([
      listarDocumentosAdmin({ empreendimentoId: projeto.empreendimento_id, projetoId: projeto.id }, { pagina }).catch(() => null),
      listarEstruturaDocumentos(projeto.empreendimento_id).catch(() => null),
    ])
    : [null, null];
  const hrefPagina = (alvo: number) => `/${adminPath}/portal/projetos/${projeto.id}?pagina=${alvo}#documentos-do-projeto`;
  const opcoesEtapa = [...etapas].sort((a, b) => a.ordem - b.ordem).map((e) => ({ valor: e.id, nome: e.nome }));
  // Sugestão e histórico vêm do banco com a sessão de quem abriu a página; se falhar, o resto da página continua.
  const etapasPelasPastas = await etapasDoProjeto(projeto.id, projeto.empreendimento_id, !somenteLeitura).catch(() => null);
  return (
    <div className="portal-entrada space-y-10">
      <header>
        <Link className="portal-voltar" href={`/${adminPath}/portal/empreendimentos/${projeto.empreendimento_id}`} prefetch={false}><ArrowLeft size={16} aria-hidden="true" />Voltar ao empreendimento</Link>
        <h1 className="portal-titulo">{projeto.nome}</h1>
        <p className="portal-descricao">
          {progresso === null ? "Andamento indisponível: confira a etapa atual." : `${progresso}% de andamento para o cliente.`}{" "}
          O percentual vem da posição da etapa atual na ordem, não das etapas concluídas.
        </p>
        {pai && paiPendente && (
          <p role="status" className="mt-3 rounded-md border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
            Este projeto depende de {pai.nome}, que ainda não foi concluído. O aviso não impede o andamento.
          </p>
        )}
      </header>
      <Gestor recurso="projetos" adminPath={adminPath} titulo="Nome do projeto" registros={[projeto]} apenasEditar somenteLeitura={somenteLeitura}
        camposCriar={[{ nome: "nome", rotulo: "Nome do projeto" }, { nome: "projetoPaiId", rotulo: "Depende de (opcional)", tipo: "select", nullable: true, opcoes: projetosDoEmpreendimento }]} />
      {etapasPelasPastas && <SecaoEtapasDoProjeto adminPath={adminPath} projetoId={projeto.id} dados={etapasPelasPastas} podeEditar={!somenteLeitura} />}
      <div>
        {!somenteLeitura && <p className="text-sm text-muted-foreground">
          Salve para aplicar tudo de uma vez. Uma etapa nova só pode virar a etapa atual depois de salva. Concluir uma etapa não avança a etapa atual.
          Etapas citadas em atualizações e categorias com documentos não podem ser removidas.
        </p>}
        <Gestor recurso="projeto-etapas" adminPath={adminPath} titulo="Etapas e categorias de documentos" registros={[{ ...detalhe, nome: projeto.nome }]} apenasEditar somenteLeitura={somenteLeitura}
          camposCriar={[
            { nome: "etapaAtualId", rotulo: "Etapa atual", tipo: "select", nullable: true, opcoes: opcoesEtapa },
            { nome: "etapas", rotulo: "Etapa", tipo: "lista", concluir: true },
            { nome: "categorias", rotulo: "Categoria de documento", tipo: "lista" },
          ]} />
      </div>
      {podeVerDocumentos && (
        <section id="documentos-do-projeto" aria-labelledby="titulo-documentos-projeto" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-documentos-projeto" className="text-xl font-medium">Documentos do projeto</h2>
            <Button asChild variant="outline" className="portal-botao">
              <Link href={`/${adminPath}/portal/documentos?${new URLSearchParams({ empreendimento: projeto.empreendimento_id, projeto: projeto.id })}#projeto-${projeto.id}`} prefetch={false}>Abrir na tela Documentos</Link>
            </Button>
          </div>
          {documentos && estrutura ? (
            <ListaDocumentosAdmin
              adminPath={adminPath}
              documentos={documentos.registros}
              nomesEmpreendimento={{}}
              estrutura={estrutura}
              estruturaAgrupamento={estrutura}
              ehAdmin={perfil.papel === "admin"}
              somenteLeitura={!permissoes.has("documentos.editar")}
              podeLiberar={permissoes.has("documentos.liberar")}
              hrefAnterior={pagina > 1 ? hrefPagina(pagina - 1) : null}
              hrefProxima={documentos.proximaPagina ? hrefPagina(documentos.proximaPagina) : null}
              cartoesAbertos
            />
          ) : (
            <MensagemDeErro>Não foi possível carregar os documentos. Atualize a página para tentar novamente.</MensagemDeErro>
          )}
        </section>
      )}
    </div>
  );
}
