import Link from "next/link";
import { notFound } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepararAdmin } from "@/lib/portal/andamento/admin";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { listarFilaRelatos } from "@/lib/portal/obras/consultas";
import { rotuloStatus, rotuloSituacao } from "@/lib/portal/obras/regras";
import { consultaSchema } from "@/app/api/(modules)/adm-interno/portal/relatos/schema";
import { Relato } from "@/components/portal/obras/Relato";
import { RevisarRelato } from "@/components/admin/portal/obras/RevisarRelato";
import { Paginacao } from "@/components/admin/portal/andamento/Paginacao";
import "@/components/portal/obras/obras.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisão de relatos", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const adminPath = await prepararAdmin();
  const { permissoes } = await exigirRegraPagina("obras.ver");
  const podeAprovar = permissoes.has("obras.aprovar");
  const consulta = consultaSchema.safeParse(await searchParams);
  if (!consulta.success) notFound();
  const { status, obraId, pagina } = consulta.data;
  const lista = await listarFilaRelatos(consulta.data, consulta.data);
  const base = `/${adminPath}/portal/relatos`;
  const filtroObra = obraId ? `&obraId=${obraId}` : "";
  return <div className="portal-entrada obras-painel"><div><p className="portal-sobretitulo">Gestão do portal</p><h1 className="portal-titulo">Relatos de obra</h1><p className="portal-descricao">{podeAprovar ? "Aprovar publica o relato para o cliente e atualiza o progresso oficial. Devolver preserva o progresso atual e envia o motivo ao empreiteiro." : "Relatos enviados pelos empreiteiros e a situação de cada revisão."}</p></div>
    <nav className="portal-abas" aria-label="Status dos relatos">{(["pendente", "aprovado", "devolvido"] as const).map((item) => <Link key={item} prefetch={false} aria-current={status === item ? "page" : undefined} href={`${base}?status=${item}${filtroObra}`}>{rotuloStatus(item)}</Link>)}</nav>
    {obraId && <div><Button asChild variant="outline"><Link href={`${base}?status=${status}`} prefetch={false}><X aria-hidden="true" />Mostrar relatos de todas as obras</Link></Button></div>}
    {!lista.registros.length && <p className="portal-vazio">Nenhum relato nesta lista.</p>}
    {lista.registros.map((relato) => <article className="obras-cartao space-y-5" key={relato.id}><div><h2>{relato.obraNome}</h2><p className="text-sm text-muted-foreground">{relato.empreendimentoNome ?? "Empreendimento"} · {relato.autorNome ?? "Empreiteiro"}</p><p className="mt-2 text-sm">Oficial hoje: {relato.percentualAtual}% · {rotuloSituacao(relato.situacaoAtual)}</p></div><Relato relato={relato} />{podeAprovar && relato.status === "pendente" && <RevisarRelato key={`${relato.id}-${relato.percentualAtual}-${relato.situacaoAtual}`} relato={relato} adminPath={adminPath} />}</article>)}
    <Paginacao pagina={pagina} proxima={lista.proximaPagina} base={`${base}?status=${status}${filtroObra}`} />
  </div>;
}
