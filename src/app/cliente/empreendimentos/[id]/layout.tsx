import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import z from "zod";
import { exigirPapel } from "@/lib/auth/guard";
import { obterEmpreendimento } from "@/lib/portal/comum/consultas";
import { SeloSituacao } from "@/components/portal/comum/SeloSituacao";
import { NavegacaoEmpreendimento } from "@/components/portal/comum/NavegacaoEmpreendimento";

export default async function EmpreendimentoLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await exigirPapel(["cliente"], { semAcesso: "entrar" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const empreendimento = await obterEmpreendimento(id);
  if (!empreendimento) notFound();

  return (
    <>
      <header>
        <Link className="portal-voltar" href="/cliente" prefetch={false}><ArrowLeft size={16} aria-hidden="true" />Todos os empreendimentos</Link>
        <p className="portal-sobretitulo">Seu empreendimento</p>
        <h1 className="portal-titulo">{empreendimento.nome}</h1>
        {empreendimento.cidade && <p className="portal-descricao">{empreendimento.cidade}</p>}
        {empreendimento.situacao === "arquivado" && <SeloSituacao situacao="arquivado" className="mt-3">Arquivado · Histórico disponível</SeloSituacao>}
      </header>
      <NavegacaoEmpreendimento empreendimentoId={empreendimento.id} />
      {children}
    </>
  );
}
