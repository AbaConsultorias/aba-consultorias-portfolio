import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import z from "zod";
import { prepararAdminComRegra, numeroPagina, opcoes, opcoesEtapas } from "@/lib/portal/andamento/admin";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { listar } from "@/app/api/(modules)/adm-interno/portal/atualizacoes/service";
import { listar as listarFotos } from "@/app/api/(modules)/adm-interno/portal/atualizacao-fotos/service";
import { Gestor } from "@/components/admin/portal/andamento/Gestor";
import { FotosAdmin } from "@/components/admin/portal/andamento/FotosAdmin";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import type { Campo } from "@/components/admin/portal/andamento/Formulario";
import { SeletorEmpreendimento } from "@/components/admin/portal/comum/SeletorEmpreendimento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atualizações", robots: { index: false, follow: false } };

type Busca = { pagina?: string; empreendimentoId?: string; atualizacaoId?: string };

export default async function Page({ searchParams }: { searchParams: Promise<Busca> }) {
  const { adminPath, permissoes } = await prepararAdminComRegra("atualizacoes.ver");
  const somenteLeitura = !permissoes.has("atualizacoes.editar");
  const verProjetos = permissoes.has("empreendimentos.ver");
  const busca = await searchParams;
  const base = `/${adminPath}/portal/atualizacoes`;

  if (busca.atualizacaoId) {
    const atualizacaoId = z.uuid().safeParse(busca.atualizacaoId);
    if (!atualizacaoId.success) notFound();
    const encontradas = await listar({ pagina: 1, limite: 1, id: atualizacaoId.data });
    const atualizacao = encontradas.registros[0];
    if (!atualizacao) notFound();
    const fotos = await listarFotos({ pagina: 1, limite: 100, atualizacaoId: atualizacao.id });
    return (
      <div className="portal-entrada space-y-8">
        <header>
          <Link className="portal-voltar" href={`${base}?empreendimentoId=${atualizacao.empreendimento_id}`} prefetch={false}><ArrowLeft size={16} aria-hidden="true" />Voltar às atualizações</Link>
          <h1 className="portal-titulo">{atualizacao.titulo}</h1>
          <p className="portal-descricao">
            {atualizacao.publicado ? "Publicada: as fotos já aparecem para os clientes vinculados." : "Rascunho: o cliente só vê depois de publicada."}
          </p>
        </header>
        <FotosAdmin adminPath={adminPath} atualizacaoId={atualizacao.id} registros={fotos.registros.map(({ id, mime, ordem }) => ({ id, mime, ordem }))} somenteLeitura={somenteLeitura} />
      </div>
    );
  }

  const empreendimento = busca.empreendimentoId ? z.uuid().safeParse(busca.empreendimentoId) : null;
  if (empreendimento && !empreendimento.success) notFound();

  if (!empreendimento) {
    const empreendimentos = await listarOpcoesEmpreendimentos();
    return (
      <div className="portal-entrada">
        <p className="portal-sobretitulo">Gestão do portal</p>
        <h1 className="portal-titulo">Atualizações</h1>
        <p className="portal-descricao">Escolha o empreendimento para cadastrar e publicar visitas e fotos.</p>
        <SeletorEmpreendimento itens={empreendimentos} href={(id) => `${base}?empreendimentoId=${id}`} />
        {!empreendimentos.length && <p className="portal-vazio">Cadastre um empreendimento primeiro.</p>}
      </div>
    );
  }

  const empreendimentoId = empreendimento.data;
  const pagina = numeroPagina(busca.pagina);
  const [lista, projetos, etapas] = await Promise.all([
    listar({ pagina, limite: 50, empreendimentoId }), verProjetos ? opcoes("projetos", empreendimentoId) : [], verProjetos ? opcoesEtapas(empreendimentoId) : [],
  ]);
  const campos: Campo[] = [
    { nome: "titulo", rotulo: "Título" },
    { nome: "texto", rotulo: "Texto (simples, sem formatação)", tipo: "longo", nullable: true },
    { nome: "dataVisita", rotulo: "Data da visita", tipo: "data", nullable: true },
    ...(verProjetos ? [
      { nome: "projetoId", rotulo: "Projeto (opcional)", tipo: "select", nullable: true, opcoes: projetos } satisfies Campo,
      { nome: "etapaId", rotulo: "Etapa do projeto (opcional)", tipo: "select", nullable: true, opcoes: etapas, filtrarPor: { campo: "projetoId", vazio: "Escolha um projeto primeiro" } } satisfies Campo,
    ] : []),
  ];
  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Gestão do portal</p>
      <h1 className="portal-titulo">Atualizações</h1>
      {!somenteLeitura && <p className="portal-descricao">
        Adicione as fotos ao criar a atualização e escolha se deseja publicar para o cliente após todos os envios. Você também pode salvar um rascunho e usar Publicar ou Ocultar na lista. Remover uma foto oculta a atualização.
      </p>}
      <div className="portal-secao">
        <Gestor recurso="atualizacoes" adminPath={adminPath} titulo="Atualizações do empreendimento" registros={lista.registros} detalhe="atualizacoes" somenteLeitura={somenteLeitura}
          camposCriar={campos} camposEditar={[...campos, { nome: "publicado", rotulo: "Publicada para o cliente", tipo: "boolean" }]}
          iniciais={{ empreendimentoId, titulo: "", texto: null, dataVisita: null, projetoId: null, etapaId: null }} />
        <Paginacao pagina={pagina} proxima={lista.proximaPagina} base={`${base}?empreendimentoId=${empreendimentoId}`} />
      </div>
    </div>
  );
}
