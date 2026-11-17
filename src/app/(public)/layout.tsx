import { Instrument_Serif } from "next/font/google";
import { cn } from "@/lib/utils";
import { obterConfiguracoes } from "@/lib/conteudo/consultas";
import { Cabecalho } from "@/components/publico/Cabecalho";
import { Rodape } from "@/components/publico/Rodape";
import { WhatsAppFlutuante } from "@/components/publico/WhatsAppFlutuante";
import { ProvedorMovimento } from "@/components/publico/ProvedorMovimento";
import "@/components/publico/publico.css";

const fonteSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-nova-serif",
});

export default async function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const configuracoes = await obterConfiguracoes();

  return (
    <div className={cn("nova flex min-h-svh flex-col overflow-x-clip bg-(--nova-fundo) text-(--nova-tinta) antialiased", fonteSerif.variable)}>
      <a href="#conteudo" className="sr-only rounded-full bg-white px-5 py-3 font-semibold text-brand-dark focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[80] focus:outline-2 focus:outline-(--nova-acento)">
        Pular para o conteúdo
      </a>
      <ProvedorMovimento>
        <Cabecalho configuracoes={configuracoes} />
        <main id="conteudo" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <Rodape configuracoes={configuracoes} />
        <WhatsAppFlutuante configuracoes={configuracoes} />
      </ProvedorMovimento>
    </div>
  );
}
