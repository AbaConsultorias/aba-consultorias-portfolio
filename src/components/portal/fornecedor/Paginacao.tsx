import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
export function PaginacaoFornecedor({ pagina, proximaPagina, base, parametro = "pagina", rotulo = "Páginas" }: { pagina: number; proximaPagina: number | null; base: string; parametro?: string; rotulo?: string }) {
  const href = (valor: number) => `${base}${base.includes("?") ? "&" : "?"}${parametro}=${valor}`;
  return <nav className="forn-linha forn-paginacao" aria-label={rotulo}>
    {pagina > 1 && <Button asChild variant="outline" className="portal-botao"><Link href={href(pagina - 1)} prefetch={false}><ChevronLeft size={18} aria-hidden="true" />Anterior</Link></Button>}
    <span>Página {pagina}</span>
    {proximaPagina && <Button asChild variant="outline" className="portal-botao"><Link href={href(proximaPagina)} prefetch={false}>Próxima<ChevronRight size={18} aria-hidden="true" /></Link></Button>}
  </nav>;
}
