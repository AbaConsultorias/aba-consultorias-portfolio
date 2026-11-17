import type { Configuracoes, Servico } from "@/lib/conteudo/tipos";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Botao } from "../Botao";
import { linkWhatsApp } from "../dados";
import { Revelar } from "../Revelar";
import { Titulo } from "../Titulo";

export const CONTAINER = "mx-auto max-w-7xl px-5 sm:px-8";

export function Paragrafos({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <div className="space-y-5 break-words text-base leading-8 text-[#526B78]">{texto.split(/\r?\n\s*\r?\n/).filter((p) => p.trim()).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div>;
}

export function CardsServicos({ servicos }: { servicos: Servico[] }) {
  if (!servicos.length) return <p className="mt-8 text-[#526B78]">Converse com a equipe para conhecer os serviços disponíveis.</p>;
  return <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{servicos.map((servico, i) => (
    <li key={servico.id} className="min-w-0"><Revelar atraso={i * 80} className="h-full">
      <Link href={`/servicos/${servico.slug}`} className="group flex h-full flex-col rounded-[1.75rem] border border-brand-dark/10 bg-white p-7 transition-[translate,border-color,box-shadow] duration-500 hover:-translate-y-1 hover:border-brand/40 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand motion-reduce:hover:translate-y-0">
        <span className="flex items-center justify-between text-sm text-(--nova-acento)"><span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span><ArrowUpRight aria-hidden="true" className="size-5 transition-transform duration-500 group-hover:translate-x-1 group-hover:-translate-y-1 motion-reduce:group-hover:transform-none" /></span>
        <h3 className="mt-8 text-2xl font-semibold tracking-tight break-words">{servico.titulo}</h3>
        {servico.subtitulo && <p className="mt-2 text-sm font-medium text-(--nova-acento)">{servico.subtitulo}</p>}
        {servico.resumo && <p className="mt-4 flex-1 text-sm leading-7 text-[#526B78]">{servico.resumo}</p>}
        <span className="mt-7 border-t border-brand-dark/10 pt-5 text-sm font-semibold">Conheça o serviço</span>
      </Link>
    </Revelar></li>
  ))}</ul>;
}

export function ChamadaContato({ configuracoes, mensagem = "Olá! Quero conversar sobre meu projeto com a ABA." }: { configuracoes: Configuracoes; mensagem?: string | null }) {
  return <section aria-labelledby="conversa-titulo" className={`${CONTAINER} py-20 sm:py-28`}>
    <div className="grid items-center gap-8 rounded-[2rem] border border-brand-dark/10 bg-white p-7 sm:p-12 lg:grid-cols-[1fr_auto]">
      <Titulo id="conversa-titulo" partes={["Vamos tirar seu projeto", { acento: "do papel?" }]} />
      <Revelar><Botao href={linkWhatsApp(mensagem, configuracoes.whatsapp)} externo variante="whatsapp" icone="whatsapp">Converse com a ABA</Botao></Revelar>
    </div>
  </section>;
}
