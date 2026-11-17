import { notFound } from "next/navigation";
import z from "zod";
import { EditorFinanceiro } from "@/components/admin/portal/financeiro/EditorFinanceiro";
import { ResumoFinanceiroAdmin } from "@/components/admin/portal/financeiro/ResumoFinanceiroAdmin";
import { SecaoContratos } from "@/components/admin/portal/financeiro/SecaoContratos";
import { SecaoEventos } from "@/components/admin/portal/financeiro/SecaoEventos";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { projetosEmOrdem } from "@/lib/portal/andamento/admin";
import { listarOpcoesEmpreendimentos, listarOpcoesFornecedores } from "@/lib/portal/comum/opcoes";
import {
  listarDocumentosDoContrato, listarEventosFinanceiros, listarMarcosDosProjetos, listarObservacoesParcelas, obterFinanceiro,
} from "@/lib/portal/financeiro/consultas";
import { dataCivilDeHoje } from "@/lib/portal/financeiro/regras";
import { SeletorEmpreendimento } from "@/components/admin/portal/comum/SeletorEmpreendimento";

export const dynamic = "force-dynamic";

export default async function FinanceiroAdminPage({ searchParams }: {
  searchParams: Promise<{ empreendimento?: string | string[] }>;
}) {
  const { permissoes } = await exigirRegraPagina("financeiro.ver");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const { empreendimento: parametro } = await searchParams;
  const selecionado = typeof parametro === "string" && z.uuid().safeParse(parametro).success ? parametro : null;
  const empreendimentos = await listarOpcoesEmpreendimentos();
  const atual = empreendimentos.find((item) => item.id === selecionado) ?? null;
  const dados = atual
    ? await Promise.all([
      obterFinanceiro(atual.id),
      listarObservacoesParcelas(atual.id),
      listarOpcoesFornecedores(),
      listarEventosFinanceiros(atual.id),
      listarDocumentosDoContrato(atual.id),
      projetosEmOrdem(atual.id),
      listarMarcosDosProjetos(atual.id).catch(() => []),
    ])
    : null;
  const somenteLeitura = !permissoes.has("financeiro.editar");

  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Financeiro</p>
      <h1 className="portal-titulo">Contratos, parcelas e pagamentos</h1>
      <p className="portal-descricao">Escolha o empreendimento para cadastrar contratos com parcelas por data ou por evento, marcar eventos e registrar pagamentos. O cliente vê o resultado no portal.</p>
      {empreendimentos.length === 0 ? (
        <p className="portal-vazio">Nenhum empreendimento cadastrado.</p>
      ) : (
        <SeletorEmpreendimento itens={empreendimentos} atualId={atual?.id} compacto={Boolean(atual)}
          href={(id) => `/${adminPath}/portal/financeiro?empreendimento=${id}`} />
      )}
      {selecionado && !atual && <p role="alert" className="portal-vazio">Empreendimento não encontrado.</p>}
      {atual && dados && (
        <section className="portal-secao flex flex-col gap-8" aria-label={`Financeiro de ${atual.nome}`}>
          <h2>{atual.nome}</h2>
          <ResumoFinanceiroAdmin resumo={dados[0].resumo} />
          <SecaoContratos
            adminPath={adminPath}
            empreendimentoId={atual.id}
            contratos={dados[0].itens.filter((item) => item.fornecedorId === null)}
            observacoes={dados[1]}
            projetos={dados[5].map(({ id, nome }) => ({ id, nome }))}
            documentos={dados[4]}
            podeEscolherPdf={permissoes.has("documentos.ver")}
            hoje={dataCivilDeHoje()}
            somenteLeitura={somenteLeitura}
          />
          <SecaoEventos
            adminPath={adminPath}
            empreendimentoId={atual.id}
            eventos={dados[3]}
            contratos={dados[0].itens.filter((item) => item.fornecedorId === null)}
            projetos={dados[5].map(({ id, nome }) => ({ id, nome }))}
            marcos={dados[6]}
            hoje={dataCivilDeHoje()}
            somenteLeitura={somenteLeitura}
          />
          <EditorFinanceiro
            adminPath={adminPath}
            empreendimentoId={atual.id}
            itens={dados[0].itens.filter((item) => item.fornecedorId !== null)}
            observacoes={dados[1]}
            fornecedores={dados[2]}
            hoje={dataCivilDeHoje()}
            somenteLeitura={somenteLeitura}
          />
        </section>
      )}
    </div>
  );
}
