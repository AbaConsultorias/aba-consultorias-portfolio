import type { Metadata } from "next";
import z from "zod";
import { Mail, MapPin, Phone } from "lucide-react";
import { obterConfiguracoes, obterLoteamentoParaContato } from "@/lib/conteudo/consultas";
import { metadadosDaPagina } from "@/lib/seo";
import { HeroInterno } from "@/components/publico/paginas/HeroInterno";
import { FormularioContato } from "@/components/publico/paginas/FormularioContato";
import { CONTAINER } from "@/components/publico/paginas/Conteudo";
import { Botao } from "@/components/publico/Botao";
import { linkWhatsApp } from "@/components/publico/dados";
import { Revelar } from "@/components/publico/Revelar";
import { Titulo } from "@/components/publico/Titulo";

export const revalidate = 300;
export function generateMetadata(): Metadata { return metadadosDaPagina({ titulo: "Contato", descricao: "Converse com a equipe da ABA sobre seu loteamento, sua obra ou o projeto da sua casa.", caminho: "/contato" }); }
type Props = { searchParams: Promise<{ loteamento?: string | string[]; lote?: string | string[] }> };
const slugSchema = z.string().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// "<quadra>-<numero>" vindo do link "Tenho interesse": só entra no texto da mensagem.
const LOTE = /^([A-Za-z0-9À-ÿ]{1,20})-([A-Za-z0-9À-ÿ]{1,20})$/;

function loteDaUrl(valor: string | string[] | undefined) {
  const achado = typeof valor === "string" ? LOTE.exec(valor) : null;
  return achado ? { quadra: achado[1], numero: achado[2] } : undefined;
}

export default async function ContatoPage({ searchParams }: Props) {
  const parametros = await searchParams;
  const slug = slugSchema.safeParse(parametros.loteamento);
  const [c, loteamento] = await Promise.all([obterConfiguracoes(), slug.success ? obterLoteamentoParaContato(slug.data) : Promise.resolve(null)]);
  const lote = loteamento ? loteDaUrl(parametros.lote) : undefined;
  const mapa = z.url().refine((url) => url.startsWith("https://")).safeParse(c.mapaUrl);
  return <>
    <HeroInterno sobrancelha="Fale com a ABA" partes={["Seu próximo projeto começa", { acento: "aqui." }]} atual="Contato" />
    <div className={`${CONTAINER} grid items-start gap-12 py-16 sm:py-24 lg:grid-cols-2 lg:gap-20`}>
      <Revelar>
        <Titulo id="contato-titulo" partes={["Uma conversa,", { acento: "muitas possibilidades." }]} />
        <p className="mt-7 mb-8 max-w-lg leading-8 text-[#526B78]">Conte sobre seu loteamento ou sua casa. Vamos entender o que você precisa e conversar sobre os próximos passos.</p>
        <Botao href={linkWhatsApp(loteamento ? `Olá! Tenho interesse no loteamento ${loteamento.nome}.` : "Olá! Vim pelo site e quero conversar com a ABA.", c.whatsapp)} externo variante="whatsapp" icone="whatsapp">Conversar pelo WhatsApp</Botao>
        <address className="mt-10 space-y-6 border-t border-brand-dark/15 pt-8 text-base leading-7 not-italic">
          {c.email && <p className="flex min-w-0 items-start gap-3"><Mail aria-hidden="true" className="mt-1 size-5 shrink-0 text-(--nova-acento)" /><a href={`mailto:${c.email}`} className="break-all transition-colors duration-500 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">{c.email}</a></p>}
          {c.telefone && <p className="flex items-start gap-3"><Phone aria-hidden="true" className="mt-1 size-5 shrink-0 text-(--nova-acento)" /><a href={`tel:${c.telefone.replace(/[^+\d]/g, "")}`} className="transition-colors duration-500 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">{c.telefone}</a></p>}
          {c.endereco && <p className="flex items-start gap-3"><MapPin aria-hidden="true" className="mt-1 size-5 shrink-0 text-(--nova-acento)" /><span className="whitespace-pre-line">{c.endereco}</span></p>}
        </address>
        {mapa.success && <div className="mt-8"><Botao href={mapa.data} externo variante="contorno">Ver localização no mapa</Botao></div>}
      </Revelar>
      <FormularioContato key={`${loteamento?.id ?? "geral"}:${lote ? `${lote.quadra}-${lote.numero}` : ""}`} interesse={loteamento ? { id: loteamento.id, nome: loteamento.nome, lote } : undefined} />
    </div>
  </>;
}
