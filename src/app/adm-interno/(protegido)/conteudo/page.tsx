import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Conteúdo do site" };

type Secao = {
  slug: string;
  rotulo: string;
  tabela: string;
  descricao: string;
};

const SECOES: Secao[] = [
  { slug: "topo", rotulo: "Topo do site", tabela: "banners_hero", descricao: "banners" },
  { slug: "servicos", rotulo: "Serviços", tabela: "servicos", descricao: "serviços" },
  { slug: "projetos", rotulo: "Projetos", tabela: "portfolio_projetos", descricao: "projetos" },
  { slug: "loteamentos", rotulo: "Loteamentos", tabela: "loteamentos", descricao: "loteamentos" },
  { slug: "depoimentos", rotulo: "Depoimentos e avaliações", tabela: "depoimentos", descricao: "depoimentos" },
  { slug: "parceiros", rotulo: "Parceiros", tabela: "parceiros", descricao: "parceiros" },
  { slug: "videos", rotulo: "Vídeos do Instagram", tabela: "videos_instagram", descricao: "vídeos" },
];

async function contar(tabela: string, filtro?: { coluna: string; valor: boolean }) {
  const supabase = await createClient();
  let consulta = supabase.from(tabela).select("id", { count: "exact", head: true });
  if (filtro) consulta = consulta.eq(filtro.coluna, filtro.valor);

  const { count, error } = await consulta;
  if (error) {
    console.error("[painel] falha ao contar:", error.code);
    return null;
  }
  return count ?? 0;
}

export default async function PainelConteudoPage() {
  const { permissoes } = await exigirRegraPagina({ qualquer: ["site.ver", "contatos.ver"] });
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  const veSite = permissoes.has("site.ver");
  const veContatos = permissoes.has("contatos.ver");

  const [totais, publicados] = veSite
    ? await Promise.all([
        Promise.all(SECOES.map((secao) => contar(secao.tabela))),
        Promise.all(SECOES.map((secao) => contar(secao.tabela, { coluna: "publicado", valor: true }))),
      ])
    : [[], []];
  const naoLidos = veContatos ? await contar("contatos", { coluna: "lido", valor: false }) : null;

  const base = `/${adminPath}/conteudo`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Conteúdo do site</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {veSite
            ? "Edite o que aparece no site público. As mudanças valem para quem visitar o site logo depois de salvar."
            : "Veja as mensagens enviadas pelo formulário do site."}
        </p>
      </div>

      {veContatos && (
        <Link
          href={`${base}/contatos`}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="font-medium">Contatos recebidos</span>
          <span className="text-sm text-muted-foreground">
            {naoLidos === null ? "—" : naoLidos === 0 ? "Nenhum para ler" : `${naoLidos} ${naoLidos === 1 ? "novo" : "novos"}`}
          </span>
        </Link>
      )}

      {veSite && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECOES.map((secao, indice) => (
              <li key={secao.slug}>
                <Link
                  href={`${base}/${secao.slug}`}
                  className="flex h-full flex-col gap-1 rounded-xl border border-border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="font-medium">{secao.rotulo}</span>
                  <span className="text-2xl font-semibold tabular-nums">{totais[indice] ?? "—"}</span>
                  <span className="text-sm text-muted-foreground">
                    {publicados[indice] === null
                      ? `${secao.descricao} cadastrados`
                      : `${publicados[indice]} publicados de ${totais[indice]} ${secao.descricao}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground">
            <Link href={`${base}/configuracoes`} className="underline underline-offset-4 hover:text-foreground">
              Configurações
            </Link>{" "}
            reúne contatos, redes sociais e a nota do Google.
          </p>
        </>
      )}
    </div>
  );
}
