"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MENSAGEM_SEM_CONEXAO, lerResposta, mensagemDeErro } from "./resposta";

export function LogoutButton({ redirecionarPara = "/entrar" }: { redirecionarPara?: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setErro(null);
    try {
      const res = await fetch("/api/sair", { method: "POST" });
      // Em 5xx a sessão pode continuar ativa: redirecionar só faria a área abrir de novo.
      if (res.status >= 500) {
        setErro(mensagemDeErro(await lerResposta(res), res.status));
        return;
      }
      router.push(redirecionarPara);
      router.refresh();
    } catch {
      setErro(MENSAGEM_SEM_CONEXAO);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Saindo..." : "Sair"}
      </Button>
      {erro && (
        <p role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      )}
    </>
  );
}
