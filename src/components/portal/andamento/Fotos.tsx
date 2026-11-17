"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FotoPortal } from "@/lib/portal/andamento/tipos";

function Foto({ foto }: { foto: FotoPortal }) {
  const [falhou, setFalhou] = useState(false);
  return <figure className="min-w-0">
    {falhou ? <div className="portal-foto flex items-center justify-center p-6 text-center text-sm text-muted-foreground">Não foi possível carregar esta foto. Atualize a página ou use Baixar original.</div>
      // A rota autentica cada acesso; o otimizador de imagens não deve armazenar fotos privadas.
      // eslint-disable-next-line @next/next/no-img-element
      : <img className="portal-foto" src={foto.urlDaRota} alt="Registro fotográfico do andamento" width={640} height={480} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} />}
    <figcaption className="mt-2"><Button asChild variant="outline" className="portal-botao"><a href={`${foto.urlDaRota}?baixar=1`} download referrerPolicy="no-referrer"><Download size={18} aria-hidden="true" />Baixar original</a></Button></figcaption>
  </figure>;
}
export function Fotos({ fotos }: { fotos: FotoPortal[] }) {
  if (!fotos.length) return null;
  return <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fotos.map((foto) => <Foto key={foto.id} foto={foto} />)}</div>;
}
