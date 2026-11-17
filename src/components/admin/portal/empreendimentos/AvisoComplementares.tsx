import Link from "next/link";
import { CircleCheck } from "lucide-react";

// O SAA ou o SES chegou à etapa "Aprovado" e a leitura dos complementares segue desligada. Ligar continua manual.
// `href` é nulo para quem não abre a aba "Pasta do servidor" (sem servidor.regras): a pessoa só vê o aviso.
export function AvisoComplementares({ href }: { href: string | null }) {
  return (
    <div role="status" className="flex min-w-0 items-start gap-3 rounded-xl border border-primary/40 bg-card p-4 text-sm">
      <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">Pronto para ler os complementares</p>
        <p className="text-muted-foreground">
          O SAA ou o SES deste empreendimento chegou à etapa “Aprovado”. Já dá para ligar “Ler projetos complementares” e montar PER, PEC, Descrição Topográfica e Estruturais.
        </p>
        {href && (
          <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            Abrir a aba Pasta do servidor
          </Link>
        )}
      </div>
    </div>
  );
}
