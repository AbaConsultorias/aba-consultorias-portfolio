import { ChevronRight } from "lucide-react";

// A regra guarda o caminho do servidor (Windows ou barra comum): cada pasta vira uma migalha, a última em destaque.
export function Migalhas({ caminho }: { caminho: string }) {
  const pastas = caminho.split(/[\\/]+/).filter((pasta) => pasta !== "");
  if (pastas.length === 0) return <p className="font-medium [overflow-wrap:anywhere]">{caminho}</p>;
  return (
    <ol aria-label="Caminho da pasta" title={caminho} className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
      {pastas.map((pasta, indice) => {
        const ultima = indice === pastas.length - 1;
        return (
          <li key={`${indice}-${pasta}`} className="flex min-w-0 items-center gap-1">
            <span className={ultima ? "font-medium text-foreground [overflow-wrap:anywhere]" : "text-muted-foreground [overflow-wrap:anywhere]"}>{pasta}</span>
            {!ultima && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
