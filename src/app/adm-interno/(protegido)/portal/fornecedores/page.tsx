import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import z from "zod";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarContas } from "@/lib/portal/comum/contas";
import { listarFornecedoresAdmin } from "@/lib/portal/fornecedor/consultas";
import { consultaPaginaSchema } from "@/lib/portal/fornecedor/campos";
import { formatarCnpj } from "@/lib/portal/fornecedor/regras";
import { GestorContas } from "@/components/admin/portal/comum/GestorContas";
import { CadastroFornecedor } from "@/components/admin/portal/fornecedor/CadastroFornecedor";
import { PaginacaoFornecedor } from "@/components/portal/fornecedor/Paginacao";
import "@/components/portal/fornecedor/fornecedor.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Fornecedores | ABA", robots: { index: false, follow: false } };
const querySchema = consultaPaginaSchema.extend({ contasPagina: z.coerce.number().int().min(1).max(100000).default(1) });
export default async function FornecedoresAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { permissoes } = await exigirRegraPagina("fornecedores.ver");
  const podeEditar = permissoes.has("fornecedores.editar");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const consulta = querySchema.safeParse(await searchParams);
  if (!consulta.success) notFound();
  const { pagina, contasPagina } = consulta.data;
  const [fornecedores, contas] = await Promise.all([listarFornecedoresAdmin(consulta.data), podeEditar ? listarContas("fornecedor", { pagina: contasPagina }) : null]);
  const base = `/${adminPath}/portal/fornecedores`;
  return <div className="portal-entrada"><h1 className="portal-titulo">Fornecedores</h1><p className="portal-descricao">Cadastre fornecedores, vincule suas contas e disponibilize contratos. A observação do cadastro será visível ao fornecedor.</p>
    {podeEditar && <details className="forn-caixa mt-6"><summary>Novo fornecedor</summary><CadastroFornecedor adminPath={adminPath} /></details>}
    <section className="portal-secao"><h2>Cadastros</h2>{!fornecedores.registros.length && <p className="portal-vazio">Nenhum fornecedor nesta página.</p>}<ul className="forn-lista">{fornecedores.registros.map((f) => <li key={f.id} className="forn-caixa"><h3>{f.nome}</h3><p className="forn-ajuda">{formatarCnpj(f.cnpj)} · {f.ativo ? "Ativo" : "Inativo"}</p><Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`${base}/${f.id}`}>Cadastro, vínculos e contratos<ArrowRight size={18} aria-hidden="true" /></Link></Button></li>)}</ul><PaginacaoFornecedor pagina={pagina} proximaPagina={fornecedores.proximaPagina} base={`${base}?contasPagina=${contasPagina}`} rotulo="Páginas de fornecedores" /></section>
    {contas && <section className="portal-secao" id="contas"><h2>Contas de acesso</h2><p className="forn-ajuda">Crie a conta e depois vincule-a no cadastro do fornecedor. A senha inicial deve ser trocada no primeiro acesso.</p><GestorContas adminPath={adminPath} recurso="fornecedor-contas" rotulo="fornecedor" contas={contas.registros} /><PaginacaoFornecedor pagina={contasPagina} proximaPagina={contas.proximaPagina} base={`${base}?pagina=${pagina}`} parametro="contasPagina" rotulo="Páginas de contas" /></section>}
  </div>;
}
