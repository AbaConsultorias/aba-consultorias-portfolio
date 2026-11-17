import { notFound } from "next/navigation";
import z from "zod";
import { GradeCronograma } from "@/components/portal/cronograma/GradeCronograma";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { obterCronograma } from "@/lib/portal/cronograma/consultas";
import { mesValido } from "@/lib/portal/cronograma/regras";
import { SeletorEmpreendimento } from "@/components/admin/portal/comum/SeletorEmpreendimento";

export const dynamic = "force-dynamic";

const lerMes = (valor: string | string[] | undefined) => (typeof valor === "string" && mesValido(valor) ? valor : undefined);

export default async function CronogramaAdminPage({ searchParams }: {
  searchParams: Promise<{ empreendimento?: string | string[]; de?: string | string[]; ate?: string | string[] }>;
}) {
  await exigirRegraPagina("financeiro.ver");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const consulta = await searchParams;
  const parametro = consulta.empreendimento;
  const selecionado = typeof parametro === "string" && z.uuid().safeParse(parametro).success ? parametro : null;
  const de = lerMes(consulta.de);
  const ate = lerMes(consulta.ate);
  const empreendimentos = await listarOpcoesEmpreendimentos();
  const atual = empreendimentos.find((item) => item.id === selecionado) ?? null;
  const cronograma = atual ? await obterCronograma(atual.id, { de, ate }) : null;

  return (
    <div className="portal-entrada">
      <p className="portal-sobretitulo">Cronograma</p>
      <h1 className="portal-titulo">Cronograma de pagamentos</h1>
      <p className="portal-descricao">Escolha o empreendimento para ver as parcelas previstas mês a mês. É a mesma visão que o cliente tem no portal.</p>
      {empreendimentos.length === 0 ? (
        <p className="portal-vazio">Nenhum empreendimento cadastrado.</p>
      ) : (
        <SeletorEmpreendimento itens={empreendimentos} atualId={atual?.id} compacto={Boolean(atual)}
          href={(id) => `/${adminPath}/portal/cronograma?empreendimento=${id}`} />
      )}
      {selecionado && !atual && <p role="alert" className="portal-vazio">Empreendimento não encontrado.</p>}
      {atual && cronograma && (
        <section className="portal-secao" aria-label={`Cronograma de ${atual.nome}`}>
          <h2>{atual.nome}</h2>
          <GradeCronograma
            cronograma={cronograma}
            de={de}
            ate={ate}
            hrefLimpar={`/${adminPath}/portal/cronograma?empreendimento=${atual.id}`}
            camposOcultos={{ empreendimento: atual.id }}
          />
        </section>
      )}
    </div>
  );
}
