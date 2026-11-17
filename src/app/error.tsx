"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Nunca mostra error.message: pode carregar detalhe interno. O digest só ajuda o suporte a achar o log.
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-5 py-16 text-foreground">
      <main className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
        <Image src="/marca/aba-logo.png" alt="ABA Consultorias" width={56} height={68} priority />
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Algo deu errado</h1>
        <p className="text-pretty text-muted-foreground">
          Não foi possível carregar esta página agora. Tente de novo; se o problema continuar, volte ao início ou fale com a nossa equipe.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reset}>Tentar de novo</Button>
          <Button asChild variant="outline">
            <Link href="/">Voltar ao início</Link>
          </Button>
        </div>
        {error.digest && <p className="text-xs text-muted-foreground">Código: {error.digest}</p>}
      </main>
    </div>
  );
}
