import { notFound } from "next/navigation";
import z from "zod";
import { prepararAdminComRegra, numeroPagina, opcoesDeCampo } from "@/lib/portal/andamento/admin";
import { listarOpcoesLoteamentos } from "@/lib/portal/comum/opcoes";
import { contarLinhas } from "@/lib/portal/empreendimentos/indicadores";
import { listar as listarEmpreendimentos, permissoesDaPasta } from "@/app/api/(modules)/adm-interno/portal/empreendimentos/service";
import { estadoDosComplementares } from "@/app/api/(modules)/adm-interno/portal/pasta-montagem/service";
import { carregarPasta } from "@/app/api/(modules)/adm-interno/portal/pasta-regras/service";
import { camposEmpreendimento } from "@/components/admin/portal/andamento/campos";
import { SecaoPastaServidor } from "@/components/admin/portal/pasta/SecaoPastaServidor";
import { Abas, ABAS, type AbaDoEmpreendimento } from "@/components/admin/portal/empreendimentos/Abas";
import { AbaClientes } from "@/components/admin/portal/empreendimentos/AbaClientes";
import { AbaProjetos } from "@/components/admin/portal/empreendimentos/AbaProjetos";
import { AvisoComplementares } from "@/components/admin/portal/empreendimentos/AvisoComplementares";
import { CabecalhoDoEmpreendimento } from "@/components/admin/portal/empreendimentos/CabecalhoDoEmpreendimento";
import { DadosDoEmpreendimento } from "@/components/admin/portal/empreendimentos/DadosDoEmpreendimento";
import { ResumoDoEmpreendimento } from "@/components/admin/portal/empreendimentos/ResumoDoEmpreendimento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empreendimento", robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; editar?: string; paginaVinculos?: string; paginaProjetos?: string }>;
}) {
  const acesso = await prepararAdminComRegra("empreendimentos.ver");
  const { adminPath, permissoes } = acesso;
  const pasta = permissoesDaPasta(acesso);
  const podeEditar = permissoes.has("empreendimentos.editar");
  const verClientes = permissoes.has("clientes.ver");
  const verDocumentos = permissoes.has("documentos.ver");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const busca = await searchParams;
  const paginaVinculos = numeroPagina(busca.paginaVinculos);
  const paginaProjetos = numeroPagina(busca.paginaProjetos);
  const disponiveis: AbaDoEmpreendimento[] = ABAS.filter((aba) => (aba !== "clientes" || verClientes) && (aba !== "pasta" || pasta.podeRegras));
  const pedida = z.enum(ABAS).safeParse(busca.aba);
  const aba = pedida.success && disponiveis.includes(pedida.data) ? pedida.data : "geral";
  const [encontrados, loteamentos, projetos, clientes, liberados, ocultos, regrasAtivas] = await Promise.all([
    listarEmpreendimentos({ pagina: 1, limite: 1, id }, pasta.podeRegras),
    podeEditar ? listarOpcoesLoteamentos() : [],
    contarLinhas("projetos", { empreendimento_id: id }),
    verClientes ? contarLinhas("empreendimento_clientes", { empreendimento_id: id }) : undefined,
    verDocumentos ? contarLinhas("documentos", { empreendimento_id: id, liberado_cliente: true }) : undefined,
    verDocumentos ? contarLinhas("documentos", { empreendimento_id: id, liberado_cliente: false }) : undefined,
    pasta.podeRegras ? contarLinhas("pasta_regras", { empreendimento_id: id, ativa: true }) : undefined,
  ]);
  const empreendimento = encontrados.registros[0];
  if (!empreendimento) notFound();
  const complementares = podeEditar ? await estadoDosComplementares(id) : null;
  const base = `/${adminPath}/portal/empreendimentos/${id}`;
  const dadosPasta = aba === "pasta" ? await carregarPasta(id, empreendimento.codigo_pasta ?? null) : null;
  const camposDeEdicao = camposEmpreendimento(opcoesDeCampo(loteamentos));
  return (
    <div className="portal-entrada space-y-8">
      {complementares?.pronto && <AvisoComplementares href={pasta.podeRegras ? `${base}?aba=pasta` : null} />}
      <CabecalhoDoEmpreendimento adminPath={adminPath} id={id} nome={empreendimento.nome} situacao={empreendimento.situacao}
        camposDeEdicao={camposDeEdicao} valoresDeEdicao={{ id, nome: empreendimento.nome, cidade: empreendimento.cidade, descricao: empreendimento.descricao, situacao: empreendimento.situacao, loteamentoId: empreendimento.loteamento_id }}
        hrefAtualizacoes={permissoes.has("atualizacoes.ver") ? `/${adminPath}/portal/atualizacoes?empreendimentoId=${id}` : null}
        podeEditar={podeEditar} podeExcluir={permissoes.has("empreendimentos.excluir")} iniciarEditando={busca.editar === "1"} />
      <ResumoDoEmpreendimento base={base} hrefDocumentos={`/${adminPath}/portal/documentos?empreendimento=${id}`} dados={{
        projetos,
        ...(clientes !== undefined ? { clientes } : {}),
        ...(liberados !== undefined && ocultos !== undefined ? { documentos: { liberados, ocultos } } : {}),
        ...(regrasAtivas !== undefined ? { pasta: { codigo: empreendimento.codigo_pasta ?? null, regrasAtivas } } : {}),
      }} />
      <div className="space-y-6">
        <Abas base={base} ativa={aba} disponiveis={disponiveis} />
        {aba === "geral" && <DadosDoEmpreendimento situacao={empreendimento.situacao} cidade={empreendimento.cidade} descricao={empreendimento.descricao}
          loteamento={loteamentos.find((loteamento) => loteamento.id === empreendimento.loteamento_id)?.nome ?? null} />}
        {aba === "projetos" && <AbaProjetos adminPath={adminPath} empreendimentoId={id} base={base} pagina={paginaProjetos} podeEditar={podeEditar} verDocumentos={verDocumentos} />}
        {aba === "clientes" && <AbaClientes adminPath={adminPath} empreendimentoId={id} base={base} pagina={paginaVinculos} podeEditar={permissoes.has("clientes.editar")} />}
        {dadosPasta && <SecaoPastaServidor adminPath={adminPath} empreendimentoId={id} codigoPasta={empreendimento.codigo_pasta ?? null} liberacaoAutomatica={empreendimento.liberacao_automatica ?? false} dados={dadosPasta} ehAdmin={pasta.ehAdmin} podeEditar={podeEditar} lerComplementares={complementares?.lerComplementares ?? false} />}
      </div>
    </div>
  );
}
