import Link from "next/link";
import { notFound } from "next/navigation";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarACobrar } from "@/lib/portal/financeiro/consultas";
import { DIAS_VENCE_EM_BREVE, formatarBRL, formatarDataCivil, somarCentavos } from "@/lib/portal/financeiro/regras";
import { RolagemLateral } from "@/components/portal/comum/RolagemLateral";
import { SeloSituacaoFinanceira } from "@/components/portal/financeiro/SeloSituacaoFinanceira";
import "@/components/portal/financeiro/financeiro.css";

export const dynamic = "force-dynamic";

const FILTROS = [
  { valor: null, rotulo: "Todas" },
  { valor: "vencidas", rotulo: "Vencidas" },
  { valor: "a-vencer", rotulo: "A vencer" },
] as const;

export default async function ACobrarPage({ searchParams }: {
  searchParams: Promise<{ filtro?: string | string[] }>;
}) {
  await exigirRegraPagina("financeiro.ver");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const { filtro: parametro } = await searchParams;
  const filtro = parametro === "vencidas" || parametro === "a-vencer" ? parametro : null;

  const todas = await listarACobrar(DIAS_VENCE_EM_BREVE);
  const parcelas = filtro === null ? todas : todas.filter((parcela) => parcela.vencida === (filtro === "vencidas"));
  const total = somarCentavos(parcelas.map((parcela) => parcela.saldoCentavos));
  const base = `/${adminPath}/portal/a-cobrar`;

  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Financeiro</p>
      <h1 className="portal-titulo">A cobrar</h1>
      <p className="portal-descricao">
        Parcelas de contratos da ABA, de todos os empreendimentos, que estão vencidas ou vencem nos próximos {DIAS_VENCE_EM_BREVE} dias.
        O pagamento se registra no contrato do empreendimento.
      </p>

      <dl className="fin-resumo">
        <div className="fin-indicador">
          <dt>Total a cobrar</dt>
          <dd>{formatarBRL(total)}</dd>
          <small>{parcelas.length === 1 ? "1 parcela" : `${parcelas.length} parcelas`}</small>
        </div>
      </dl>

      <nav aria-label="Filtrar parcelas" className="fin-filtros">
        {FILTROS.map(({ valor, rotulo }) => (
          <Link key={rotulo} href={valor ? `${base}?filtro=${valor}` : base} prefetch={false} aria-current={filtro === valor ? "page" : undefined}>{rotulo}</Link>
        ))}
      </nav>

      {parcelas.length === 0 ? (
        <p className="portal-vazio">Nenhuma parcela {filtro === "vencidas" ? "vencida" : filtro === "a-vencer" ? `a vencer em até ${DIAS_VENCE_EM_BREVE} dias` : "a cobrar"} neste momento.</p>
      ) : (
        <section className="portal-secao" aria-label="Parcelas a cobrar">
          <RolagemLateral className="fin-tabela-wrap" rotulo="Parcelas a cobrar">
            <table className="fin-tabela fin-tabela-cobrar">
              <thead>
                <tr><th>Empreendimento</th><th>Contrato</th><th>Parcela</th><th>Vencimento</th><th>Saldo</th><th>Situação</th><th><span className="sr-only">Ação</span></th></tr>
              </thead>
              <tbody>
                {parcelas.map((parcela) => (
                  <tr key={parcela.parcelaId} data-estado={parcela.vencida ? "vencida" : "vence-em-breve"}>
                    <td className="fin-nome-parcela">{parcela.empreendimentoNome ?? "—"}</td>
                    <td className="fin-nome-parcela">{parcela.codigo ? `${parcela.codigo}${parcela.versao ? `.${parcela.versao}` : ""} · ` : ""}{parcela.descricao}</td>
                    <td className="fin-nome-parcela">{parcela.nome ?? "Parcela"}{parcela.numero ? ` (${parcela.numero}/${parcela.totalParcelas})` : ""}</td>
                    <td>{formatarDataCivil(parcela.vencimento)}</td>
                    <td>{formatarBRL(parcela.saldoCentavos)}</td>
                    <td><SeloSituacaoFinanceira situacao={parcela.vencida ? "vencida" : "vence-em-breve"} /></td>
                    <td><Link href={`/${adminPath}/portal/financeiro?empreendimento=${parcela.empreendimentoId}`} prefetch={false}>Abrir contrato</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RolagemLateral>
        </section>
      )}
    </div>
  );
}
