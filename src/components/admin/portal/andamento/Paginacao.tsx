import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
export function Paginacao({ pagina, proxima, base, parametro = "pagina" }: { pagina: number; proxima: number | null; base: string; parametro?: string }) {
  const separador = base.includes("?") ? "&" : "?";
  return <nav className="my-6 flex gap-3" aria-label="Páginas de registros">{pagina > 1 && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`${base}${separador}${parametro}=${pagina - 1}`}><ChevronLeft size={18} aria-hidden="true" />Anterior</Link></Button>}{proxima && <Button asChild variant="outline" className="portal-botao"><Link prefetch={false} href={`${base}${separador}${parametro}=${proxima}`}>Próxima<ChevronRight size={18} aria-hidden="true" /></Link></Button>}</nav>;
}
