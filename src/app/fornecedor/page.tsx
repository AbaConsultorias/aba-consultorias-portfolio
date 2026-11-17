import { exigirPapel } from "@/lib/auth/guard";
import { listarMeusFornecedores, obterFinanceiroFornecedor } from "@/lib/portal/fornecedor/consultas";
import { formatarCnpj } from "@/lib/portal/fornecedor/regras";
import { FinanceiroFornecedor } from "@/components/portal/fornecedor/FinanceiroFornecedor";
import "@/components/portal/fornecedor/fornecedor.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Parcelas | Fornecedor", robots: { index: false, follow: false } };
export default async function FornecedorPage() {
  await exigirPapel(["fornecedor"], { semAcesso: "entrar" });
  const [fornecedores, financeiro] = await Promise.all([listarMeusFornecedores(), obterFinanceiroFornecedor()]);
  return <div className="portal-entrada"><p className="portal-sobretitulo">Área do fornecedor</p><h1 className="portal-titulo">Parcelas e pagamentos</h1>
    <p className="portal-descricao">Acompanhe os valores contratados, os pagamentos e as condições dos seus itens.</p>
    {!fornecedores.length && <p className="portal-vazio">Nenhum fornecedor ativo vinculado à sua conta. Entre em contato com a equipe ABA.</p>}
    <div className="forn-lista">{fornecedores.map((f) => <section className="forn-caixa" key={f.id}><h2>{f.nome}</h2><p className="forn-ajuda">{f.razaoSocial} · CNPJ: {formatarCnpj(f.cnpj)}</p>{f.observacao && <p className="forn-observacao"><strong>Observação da ABA:</strong> {f.observacao}</p>}</section>)}</div>
    <FinanceiroFornecedor {...financeiro} />
  </div>;
}
