import Link from "next/link";

export const ABAS = ["geral", "projetos", "clientes", "pasta"] as const;
export type AbaDoEmpreendimento = (typeof ABAS)[number];

const ROTULO: Record<AbaDoEmpreendimento, string> = { geral: "Visão geral", projetos: "Projetos", clientes: "Clientes", pasta: "Pasta do servidor" };

export function Abas({ base, ativa, disponiveis }: { base: string; ativa: AbaDoEmpreendimento; disponiveis: readonly AbaDoEmpreendimento[] }) {
  return (
    <nav aria-label="Seções do empreendimento" className="overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {disponiveis.map((aba) => (
          <li key={aba}>
            <Link href={aba === "geral" ? base : `${base}?aba=${aba}`} prefetch={false} aria-current={aba === ativa ? "page" : undefined}
              className={`flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors ${aba === ativa ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {ROTULO[aba]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
