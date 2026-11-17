import { notFound } from "next/navigation";
import Link from "next/link";
import { Filter, X } from "lucide-react";
import z from "zod";
import { EnviarDocumento } from "@/components/admin/portal/documentos/EnviarDocumento";
import { ListaDocumentosAdmin } from "@/components/admin/portal/documentos/ListaDocumentosAdmin";
import { NavegarProjetoDocumento } from "@/components/portal/documentos/NavegarProjetoDocumento";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { Button } from "@/components/ui/button";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarOpcoesEmpreendimentos } from "@/lib/portal/comum/opcoes";
import { listarDocumentosAdmin, listarEstruturaDocumentos } from "@/lib/portal/documentos/consultas";

export const dynamic = "force-dynamic";

const buscaSchema = z.object({
  empreendimento: z.uuid().optional(),
  projeto: z.uuid().optional(),
  pagina: z.coerce.number().int().min(1).max(100000).catch(1).default(1),
});

function valor(parametro: string | string[] | undefined): string | undefined {
  return typeof parametro === "string" && parametro !== "" ? parametro : undefined;
}

export default async function DocumentosAdminPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { perfil, permissoes } = await exigirRegraPagina("documentos.ver");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();
  const bruto = await searchParams;
  const busca = buscaSchema.safeParse({ empreendimento: valor(bruto.empreendimento), projeto: valor(bruto.projeto), pagina: valor(bruto.pagina) });
  if (!busca.success) notFound();
  const { empreendimento: filtro, projeto, pagina } = busca.data;

  const empreendimentos = await listarOpcoesEmpreendimentos().catch(() => null);
  if (!empreendimentos) return <ErroDeCarga />;
  if (filtro && !empreendimentos.some((item) => item.id === filtro)) notFound();

  const [resultado, estrutura] = await Promise.all([
    listarDocumentosAdmin({ empreendimentoId: filtro, projetoId: projeto }, { pagina }).catch(() => null),
    filtro ? listarEstruturaDocumentos(filtro).catch(() => null) : Promise.resolve(null),
  ]);
  if (!resultado || (filtro && !estrutura)) return <ErroDeCarga />;

  const estruturas = estrutura ? [estrutura] : await Promise.all(
    [...new Set(resultado.registros.map((documento) => documento.empreendimentoId))]
      .map((id) => listarEstruturaDocumentos(id).catch(() => null)),
  );
  if (estruturas.some((item) => item === null)) return <ErroDeCarga />;
  const estruturaAgrupamento = {
    projetos: estruturas.flatMap((item) => item?.projetos ?? []),
    categorias: estruturas.flatMap((item) => item?.categorias ?? []),
  };

  const base = `/${adminPath}/portal/documentos`;
  const href = (alvo: number) => `${base}?${new URLSearchParams({ ...(filtro ? { empreendimento: filtro } : {}), ...(projeto ? { projeto } : {}), pagina: String(alvo) })}${projeto ? `#projeto-${projeto}` : ""}`;
  return (
    <div className="portal-entrada flex flex-col gap-6">
      <NavegarProjetoDocumento />
      <header>
        <p className="portal-sobretitulo">Gestão do portal</p>
        <h1 className="portal-titulo">Documentos</h1>
        <p className="portal-descricao">Todo PDF enviado nasce oculto. O cliente só vê o que você libera.</p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar documentos">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-sm">Empreendimento
          <Select name="empreendimento" defaultValue={filtro ?? ""}>
            <option value="">Todos os empreendimentos</option>
            {empreendimentos.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </Select>
        </label>
        <Button type="submit" variant="outline"><Filter aria-hidden="true" />Filtrar</Button>
      </form>

      {projeto && <div className="flex flex-wrap items-center gap-3 text-sm">Exibindo documentos do projeto. <Button asChild variant="outline" size="sm"><Link href={`${base}${filtro ? `?empreendimento=${filtro}` : ""}`} prefetch={false}><X aria-hidden="true" />Ver todos os documentos</Link></Button></div>}

      {permissoes.has("documentos.editar") && (filtro && estrutura ? (
        <EnviarDocumento key={filtro} adminPath={adminPath} empreendimentoId={filtro} estrutura={estrutura} />
      ) : (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Escolha um empreendimento para enviar um novo PDF.</p>
      ))}

      <ListaDocumentosAdmin
        adminPath={adminPath}
        documentos={resultado.registros}
        nomesEmpreendimento={Object.fromEntries(empreendimentos.map((item) => [item.id, item.nome]))}
        estrutura={estrutura}
        estruturaAgrupamento={estruturaAgrupamento}
        ehAdmin={perfil.papel === "admin"}
        somenteLeitura={!permissoes.has("documentos.editar")}
        podeLiberar={permissoes.has("documentos.liberar")}
        hrefAnterior={pagina > 1 ? href(pagina - 1) : null}
        hrefProxima={resultado.proximaPagina ? href(resultado.proximaPagina) : null}
      />
    </div>
  );
}

function ErroDeCarga() {
  return (
    <section className="rounded-xl border p-6">
      <h1 className="text-xl font-semibold">Documentos indisponíveis</h1>
      <MensagemDeErro>Não foi possível carregar os documentos. Atualize a página para tentar novamente.</MensagemDeErro>
    </section>
  );
}
