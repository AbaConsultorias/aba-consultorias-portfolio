import { notFound } from "next/navigation";
import z from "zod";
import { prepararAdmin, numeroPagina } from "@/lib/portal/andamento/admin";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { listarContas, type ContaPortal } from "@/lib/portal/comum/contas";
import { listarObrasAdmin } from "@/lib/portal/obras/consultas";
import { GestorObras } from "@/components/admin/portal/obras/GestorObras";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import "@/components/portal/obras/obras.css";
import { SeletorEmpreendimento } from "@/components/admin/portal/comum/SeletorEmpreendimento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Obras", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ empreendimento?: string | string[]; pagina?: string | string[] }> }) {
  const adminPath = await prepararAdmin();
  const { permissoes } = await exigirRegraPagina("obras.ver");
  const podeEditar = permissoes.has("obras.editar");
  const parametros = await searchParams;
  const consulta = z.object({ empreendimento: z.uuid().optional() }).safeParse(parametros);
  if (!consulta.success) notFound();
  const pagina = numeroPagina(parametros.pagina);
  const empreendimentos = await listarOpcoesEmpreendimentos();
  const atual = consulta.data.empreendimento ? empreendimentos.find((item) => item.id === consulta.data.empreendimento) : undefined;
  if (consulta.data.empreendimento && !atual) notFound();
  const obras = atual ? await listarObrasAdmin(atual.id) : [];
  const contas: ContaPortal[] = [];
  if (atual && podeEditar) for (let numero = 1; ; numero++) {
    const lista = await listarContas("empreiteiro", { pagina: numero, limite: 100 });
    contas.push(...lista.registros);
    if (!lista.proximaPagina) break;
  }
  return <div className="portal-entrada obras-painel"><div><p className="portal-sobretitulo">Gestão do portal</p><h1 className="portal-titulo">Obras e empreiteiros</h1><p className="portal-descricao">{podeEditar ? "Escolha o empreendimento para cadastrar obras e atribuir os responsáveis." : "Escolha o empreendimento para consultar as obras e os responsáveis."}</p></div>
    {!empreendimentos.length ? <p className="portal-vazio">Nenhum empreendimento cadastrado.</p> : <SeletorEmpreendimento itens={empreendimentos} atualId={atual?.id} compacto={Boolean(atual)} href={(id) => `/${adminPath}/portal/obras?empreendimento=${id}`} />}
    {atual && <section className="obras-painel"><h2 className="text-xl font-medium">{atual.nome}</h2><GestorObras key={atual.id} adminPath={adminPath} empreendimentoId={atual.id} obras={obras.slice((pagina - 1) * 50, pagina * 50)} contas={contas} somenteLeitura={!podeEditar} /><Paginacao pagina={pagina} proxima={obras.length > pagina * 50 ? pagina + 1 : null} base={`/${adminPath}/portal/obras?empreendimento=${atual.id}`} /></section>}
  </div>;
}
