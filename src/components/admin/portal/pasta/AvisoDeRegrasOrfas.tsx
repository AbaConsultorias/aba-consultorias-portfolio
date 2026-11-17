import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { AvisoDeRegrasOrfas as Aviso } from "@/app/api/(modules)/adm-interno/portal/pasta-regras/service";
import { limitarTexto } from "@/lib/portal/etapas/tipos";

// Painel do portal: regra que aponta para pasta renomeada ou apagada não casa mais com nenhum arquivo. O link abre a aba
// "Pasta do servidor", onde "Montar a partir do servidor" já oferece trocar pelo caminho novo.
export function AvisoDeRegrasOrfas({ adminPath, aviso }: { adminPath: string; aviso: Aviso }) {
  if (aviso.total === 0) return null;
  return (
    <section role="status" aria-label="Regras de pasta órfãs" className="mt-6 min-w-0 space-y-2 rounded-xl border border-amber-500/60 bg-amber-500/10 p-4">
      <p className="flex items-start gap-2 text-sm font-medium">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <span>{aviso.total === 1 ? "1 regra aponta para uma pasta que não existe mais" : `${aviso.total} regras apontam para pastas que não existem mais`}</span>
      </p>
      <ul className="space-y-1 text-sm">
        {aviso.empreendimentos.map((item) => (
          <li key={item.id} className="min-w-0 [overflow-wrap:anywhere]">
            <Link href={`/${adminPath}/portal/empreendimentos/${item.id}?aba=pasta`} prefetch={false} className="inline-flex min-h-11 items-center text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              {limitarTexto(item.nome)}
            </Link>
            {` — ${item.quantidade} ${item.quantidade === 1 ? "regra" : "regras"}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
