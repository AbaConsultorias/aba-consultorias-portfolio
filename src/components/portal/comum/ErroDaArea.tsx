"use client";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Nunca mostra error.message: pode carregar detalhe interno. O digest só ajuda o suporte a achar o log.
export function ErroDaArea({ error, reset, inicio }: { error: Error & { digest?: string }; reset: () => void; inicio: string }) {
  return <section className="portal-vazio" role="alert" aria-labelledby="erro-da-area">
    <TriangleAlert size={28} aria-hidden="true" className="mb-4 text-primary" />
    <h2 id="erro-da-area">Não foi possível carregar esta página</h2>
    <p>Tente de novo. Se o problema continuar, volte ao início ou fale com a equipe da ABA.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button className="portal-botao" onClick={reset}>Tentar de novo</Button>
      <Button asChild variant="outline" className="portal-botao"><Link href={inicio} prefetch={false}>Voltar ao início</Link></Button>
    </div>
    {error.digest && <p className="mt-4 text-xs">Código: {error.digest}</p>}
  </section>;
}
