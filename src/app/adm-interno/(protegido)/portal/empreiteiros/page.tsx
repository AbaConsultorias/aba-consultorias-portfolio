import { prepararAdmin, numeroPagina } from "@/lib/portal/andamento/admin";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarContas } from "@/lib/portal/comum/contas";
import { GestorContas } from "@/components/admin/portal/comum/GestorContas";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import { Card } from "@/components/ui/card";
import "@/components/portal/obras/obras.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empreiteiros", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ pagina?: string | string[] }> }) {
  const adminPath = await prepararAdmin();
  const { permissoes } = await exigirRegraPagina("obras.ver");
  const podeEditar = permissoes.has("obras.editar");
  const pagina = numeroPagina((await searchParams).pagina);
  const contas = await listarContas("empreiteiro", { pagina });
  return <div className="portal-entrada obras-painel"><div><p className="portal-sobretitulo">Gestão do portal</p><h1 className="portal-titulo">Empreiteiros</h1><p className="portal-descricao">{podeEditar ? "Cadastre as contas e atribua as obras na tela Obras. A desativação da conta interrompe o acesso." : "Contas de empreiteiro cadastradas."}</p></div>
    {podeEditar
      ? <GestorContas adminPath={adminPath} recurso="empreiteiros" rotulo="Contas de empreiteiro" contas={contas.registros} />
      : <section className="space-y-6"><h2 className="text-xl font-medium">Contas de empreiteiro</h2>{!contas.registros.length && <p className="portal-vazio">Nenhuma conta nesta página.</p>}<div className="space-y-4">{contas.registros.map((conta) => <Card key={conta.id} className="p-5"><h3 className="break-words font-semibold">{conta.nome}</h3><p className="text-sm text-muted-foreground">{conta.ativo ? "Ativa" : "Inativa"}{conta.precisaTrocarSenha ? " · Troca de senha obrigatória" : ""}</p>{conta.telefone && <p className="text-sm text-muted-foreground">{conta.telefone}</p>}</Card>)}</div></section>}
    <Paginacao pagina={pagina} proxima={contas.proximaPagina} base={`/${adminPath}/portal/empreiteiros`} /></div>;
}
