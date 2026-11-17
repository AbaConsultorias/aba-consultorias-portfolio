import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { conectorParadoHaMuito } from "@/lib/portal/conector/consultas";
import { dataHoraSaoPaulo } from "@/lib/portal/conector/formato";

// Faixa em todo o admin quando o servidor da empresa está mudo há mais de 24 h num dia útil.
// Sem conector ativo, ou com qualquer falha na consulta, não mostra nada.
export async function AvisoConectorParado() {
  const adminPath = obterAdminPath();
  if (!adminPath) return null;
  const parado = await conectorParadoHaMuito();
  if (!parado) return null;

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted px-4 py-2 text-sm">
      <TriangleAlert size={16} aria-hidden="true" className="shrink-0 text-destructive" />
      <span className="min-w-0 break-words">
        O servidor da empresa não entra em contato há mais de 24 horas
        {parado.ultimoContatoEm ? ` (último contato em ${dataHoraSaoPaulo(parado.ultimoContatoEm)})` : ""}.
      </span>
      <Link href={`/${adminPath}/portal/servidor`} prefetch={false} className="font-medium underline underline-offset-2">Ver o servidor</Link>
    </div>
  );
}
