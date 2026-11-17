import { notFound } from "next/navigation";
import { Filter } from "lucide-react";
import z from "zod";
import { FilaChegaram } from "@/components/admin/portal/conector/FilaChegaram";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { Button } from "@/components/ui/button";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { listarFila } from "@/lib/portal/conector/consultas";

export const dynamic = "force-dynamic";

const buscaSchema = z.object({
  empreendimento: z.uuid().optional(),
  pagina: z.coerce.number().int().min(1).max(100000).catch(1).default(1),
});

function valor(parametro: string | string[] | undefined): string | undefined {
  return typeof parametro === "string" && parametro !== "" ? parametro : undefined;
}

export default async function ChegaramDoServidorPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirRegraPagina("documentos.liberar");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const bruto = await searchParams;
  const busca = buscaSchema.safeParse({ empreendimento: valor(bruto.empreendimento), pagina: valor(bruto.pagina) });
  if (!busca.success) notFound();
  const { empreendimento: filtro, pagina } = busca.data;

  const empreendimentos = await listarOpcoesEmpreendimentos().catch(() => null);
  if (!empreendimentos) return <ErroDeCarga />;
  if (filtro && !empreendimentos.some((item) => item.id === filtro)) notFound();

  const resultado = await listarFila({ empreendimentoId: filtro }, { pagina }).catch(() => null);
  if (!resultado) return <ErroDeCarga />;

  const base = `/${adminPath}/portal/chegaram`;
  const href = (alvo: number) => `${base}?${new URLSearchParams({ ...(filtro ? { empreendimento: filtro } : {}), pagina: String(alvo) })}`;
  return (
    <div className="portal-entrada flex flex-col gap-6">
      <header>
        <p className="portal-sobretitulo">Gestão do portal</p>
        <h1 className="portal-titulo">Chegaram do servidor</h1>
        <p className="portal-descricao">
          PDFs enviados automaticamente pelo servidor da empresa. Todos chegam ocultos: o cliente só vê o que você libera aqui.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar documentos do servidor">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-sm">Empreendimento
          <Select name="empreendimento" defaultValue={filtro ?? ""}>
            <option value="">Todos os empreendimentos</option>
            {empreendimentos.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </Select>
        </label>
        <Button type="submit" variant="outline"><Filter aria-hidden="true" />Filtrar</Button>
      </form>

      <FilaChegaram
        adminPath={adminPath}
        itens={resultado.registros}
        hrefAnterior={pagina > 1 ? href(pagina - 1) : null}
        hrefProxima={resultado.proximaPagina ? href(resultado.proximaPagina) : null}
      />
    </div>
  );
}

function ErroDeCarga() {
  return (
    <section className="rounded-xl border p-6">
      <h1 className="text-xl font-semibold">Fila indisponível</h1>
      <MensagemDeErro>Não foi possível carregar os documentos do servidor. Atualize a página para tentar novamente.</MensagemDeErro>
    </section>
  );
}
