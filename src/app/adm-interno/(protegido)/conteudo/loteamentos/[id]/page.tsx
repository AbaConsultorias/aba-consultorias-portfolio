import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import z from "zod";
import { BotaoPublicar } from "@/components/admin/comum/BotaoPublicar";
import { ArquivosDoLoteamento } from "@/components/admin/loteamentos/ArquivosDoLoteamento";
import { assinatura, obterLoteamentoAdmin } from "@/components/admin/loteamentos/consultas";
import { ExcluirLoteamento } from "@/components/admin/loteamentos/ExcluirLoteamento";
import { GaleriaDoLoteamento } from "@/components/admin/loteamentos/GaleriaDoLoteamento";
import { LoteamentoForm } from "@/components/admin/loteamentos/LoteamentoForm";
import { LotesLoteamento } from "@/components/admin/loteamentos/LotesLoteamento";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { exigirRegraPagina } from "@/lib/auth/permissoes-servidor";
import { urlPublica } from "@/lib/conteudo/url";

export const metadata: Metadata = { title: "Editar loteamento" };

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{titulo}</h2>
        {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function EditarLoteamentoPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirRegraPagina("site.editar");
  const adminPath = obterAdminPath();
  if (!adminPath) notFound();

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const dados = await obterLoteamentoAdmin(id);
  if (!dados) notFound();

  const { loteamento, midias, lotes } = dados;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/${adminPath}/conteudo/loteamentos`}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Voltar para os loteamentos
          </Link>
          <h1 className="mt-2 truncate text-xl font-semibold">{loteamento.nome}</h1>
        </div>
        <BotaoPublicar
          adminPath={adminPath}
          caminho={`loteamentos/${loteamento.id}`}
          publicado={loteamento.publicado}
          rotulo={loteamento.nome}
        />
      </div>

      <Secao titulo="Dados do loteamento">
        <LoteamentoForm
          adminPath={adminPath}
          id={loteamento.id}
          inicial={{
            nome: loteamento.nome,
            slug: loteamento.slug,
            cidade: loteamento.cidade ?? "",
            endereco: loteamento.endereco ?? "",
            mapsUrl: loteamento.mapsUrl ?? "",
            descricao: loteamento.descricao ?? "",
            publicado: loteamento.publicado,
          }}
        />
      </Secao>

      <Secao titulo="Fotos e mapa" descricao="Cada arquivo é salvo assim que o envio termina.">
        <ArquivosDoLoteamento
          adminPath={adminPath}
          loteamentoId={loteamento.id}
          inicial={{
            capaPath: loteamento.capaPath,
            bannerPath: loteamento.bannerPath,
            bannerMobilePath: loteamento.bannerMobilePath,
            mapaSvgPath: loteamento.mapaSvgPath,
          }}
        />
      </Secao>

      <Secao titulo="Galeria" descricao="Fotos e vídeos do loteamento, na ordem em que aparecem na página.">
        <GaleriaDoLoteamento adminPath={adminPath} loteamentoId={loteamento.id} midias={midias} />
      </Secao>

      <Secao
        titulo="Lotes"
        descricao="Troque a situação com um clique. O que for marcado aqui aparece no site em instantes."
      >
        <LotesLoteamento
          key={assinatura([lotes, loteamento.mapaSvgPath])}
          adminPath={adminPath}
          loteamentoId={loteamento.id}
          mapaUrl={loteamento.mapaSvgPath ? urlPublica(loteamento.mapaSvgPath) : null}
          lotes={lotes}
        />
      </Secao>

      <Secao titulo="Excluir loteamento">
        <ExcluirLoteamento
          adminPath={adminPath}
          loteamentoId={loteamento.id}
          nome={loteamento.nome}
          totalLotes={lotes.length}
        />
      </Secao>
    </div>
  );
}
