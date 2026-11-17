import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import z from "zod";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarContas } from "@/lib/portal/comum/contas";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { obterFornecedorAdmin, listarContratosAdmin } from "@/lib/portal/fornecedor/consultas";
import { formatarCnpj } from "@/lib/portal/fornecedor/regras";
import { listar as listarVinculos } from "@/app/api/(modules)/adm-interno/portal/fornecedor-usuarios/service";
import { CadastroFornecedor } from "@/components/admin/portal/fornecedor/CadastroFornecedor";
import { ExcluirFornecedorRegistro } from "@/components/admin/portal/fornecedor/Excluir";
import { VincularConta } from "@/components/admin/portal/fornecedor/VincularConta";
import { EditarContrato } from "@/components/admin/portal/fornecedor/EditarContrato";
import { EnviarArquivo } from "@/components/portal/fornecedor/EnviarArquivo";
import { PaginacaoFornecedor } from "@/components/portal/fornecedor/Paginacao";
import "@/components/portal/fornecedor/fornecedor.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Cadastro do fornecedor | ABA", robots: { index: false, follow: false } };
const numeroPagina = z.coerce.number().int().min(1).max(100000).default(1);
export default async function FornecedorAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { permissoes } = await exigirRegraPagina("fornecedores.ver");
  const podeEditar = permissoes.has("fornecedores.editar");
  const podeExcluir = permissoes.has("fornecedores.excluir");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const parametro = z.object({ id: z.uuid() }).safeParse(await params);
  const consulta = z.object({ contasPagina: numeroPagina, vinculosPagina: numeroPagina, contratosPagina: numeroPagina }).safeParse(await searchParams);
  if (!parametro.success || !consulta.success) notFound();
  const fornecedor = await obterFornecedorAdmin(parametro.data.id);
  if (!fornecedor) notFound();
  const { contasPagina, vinculosPagina, contratosPagina } = consulta.data;
  const [contas, vinculos, contratos, empreendimentos] = await Promise.all([podeEditar ? listarContas("fornecedor", { pagina: contasPagina }) : null, listarVinculos({ fornecedorId: fornecedor.id, pagina: vinculosPagina, limite: 50 }), listarContratosAdmin(fornecedor.id), podeEditar ? listarOpcoesEmpreendimentos() : []]);
  const base = `/${adminPath}/portal/fornecedores/${fornecedor.id}`;
  const api = `/${adminPath}/api/portal`;
  const inicio = (contratosPagina - 1) * 50;
  return <div className="portal-entrada"><Link className="portal-voltar" href={`/${adminPath}/portal/fornecedores`} prefetch={false}><ArrowLeft size={16} aria-hidden="true" />Voltar para fornecedores</Link><h1 className="portal-titulo">{fornecedor.nome}</h1>
    <section className="forn-caixa"><h2>Cadastro</h2>{podeEditar ? <><p className="forn-aviso">A observação é visível ao fornecedor. Ao desativar o cadastro, seus usuários perdem o acesso aos itens e arquivos deste fornecedor.</p><CadastroFornecedor adminPath={adminPath} fornecedor={fornecedor} /></> : <p className="forn-ajuda">{formatarCnpj(fornecedor.cnpj)} · {fornecedor.ativo ? "Ativo" : "Inativo"}</p>}{podeExcluir && <ExcluirFornecedorRegistro endpoint={`${api}/fornecedores`} id={fornecedor.id} rotulo="Excluir fornecedor sem vínculos" destino={`/${adminPath}/portal/fornecedores`} />}</section>
    <section className="portal-secao"><h2>Contas vinculadas</h2>{podeEditar && <p className="forn-ajuda">Remover um vínculo revoga o acesso dessa conta aos dados deste fornecedor.</p>}{!vinculos.registros.length && <p>Nenhuma conta vinculada nesta página.</p>}<ul className="forn-lista">{vinculos.registros.map((v) => <li className="forn-caixa" key={v.id}><h3>{v.nome}</h3><p>{v.ativo ? "Conta ativa" : "Conta inativa"}</p>{podeEditar && <ExcluirFornecedorRegistro endpoint={`${api}/fornecedor-usuarios`} id={v.id} rotulo="Remover vínculo" />}</li>)}</ul><PaginacaoFornecedor pagina={vinculosPagina} proximaPagina={vinculos.proximaPagina} base={`${base}?contasPagina=${contasPagina}&contratosPagina=${contratosPagina}`} parametro="vinculosPagina" rotulo="Páginas de vínculos" />
      {contas && <div className="forn-caixa"><h3>Vincular uma conta</h3><p className="forn-ajuda">As contas são criadas na lista de fornecedores. Use as páginas abaixo para encontrar a conta.</p><VincularConta fornecedorId={fornecedor.id} contas={contas.registros} adminPath={adminPath} /><PaginacaoFornecedor pagina={contasPagina} proximaPagina={contas.proximaPagina} base={`${base}?vinculosPagina=${vinculosPagina}&contratosPagina=${contratosPagina}`} parametro="contasPagina" rotulo="Páginas de contas disponíveis" /></div>}
    </section>
    {podeEditar && <section className="portal-secao"><EnviarArquivo contrato adminPath={adminPath} fornecedores={[{ valor: fornecedor.id, nome: fornecedor.nome }]} empreendimentos={empreendimentos.map((e) => ({ valor: e.id, nome: e.nome }))} /></section>}
    <section className="portal-secao"><h2>Contratos</h2>{!contratos.length && <p>Nenhum contrato cadastrado.</p>}<ul className="forn-lista">{contratos.slice(inicio, inicio + 50).map((c) => <li key={c.id}>{podeEditar && <EditarContrato contrato={c} empreendimentos={empreendimentos} adminPath={adminPath} />}<Button asChild variant="outline" className="portal-botao"><a href={c.downloadHref}><Download size={18} aria-hidden="true" />Baixar {c.titulo}</a></Button>{podeExcluir && <ExcluirFornecedorRegistro endpoint={`${api}/fornecedor-contratos`} id={c.id} rotulo="Excluir contrato" />}</li>)}</ul><PaginacaoFornecedor pagina={contratosPagina} proximaPagina={contratos.length > inicio + 50 ? contratosPagina + 1 : null} base={`${base}?contasPagina=${contasPagina}&vinculosPagina=${vinculosPagina}`} parametro="contratosPagina" rotulo="Páginas de contratos" /></section>
  </div>;
}
