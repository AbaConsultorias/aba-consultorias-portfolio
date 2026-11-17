"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { dataHoraSaoPaulo } from "@/lib/portal/conector/formato";
import { formatarGb, type AvaliacaoUso } from "@/lib/portal/conector/uso";

type Uso = AvaliacaoUso & { objetos: number; parcial: boolean; calculadoEm: string };

// Carrega depois da página: somar o balde pode levar alguns segundos na primeira vez (depois fica em cache por 1 h).
export function UsoR2({ adminPath }: { adminPath: string }) {
  const [uso, setUso] = useState<Uso | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    chamarPortal<Uso>(adminPath, "conector/uso", "GET").then((resposta) => {
      if (!ativo) return;
      if (resposta.ok && resposta.details) setUso(resposta.details);
      else setErro(resposta.erro ?? "Não foi possível calcular o uso do armazenamento.");
    });
    return () => { ativo = false; };
  }, [adminPath]);

  if (erro) return <MensagemDeErro>{erro}</MensagemDeErro>;
  if (!uso) return <p role="status" className="text-sm text-muted-foreground">Calculando o uso do armazenamento…</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <strong className="text-lg">{formatarGb(uso.bytes)}</strong> usados de {formatarGb(uso.limite)} gratuitos
        <span className="text-muted-foreground"> · {uso.objetos} arquivo(s){uso.parcial ? " (contagem parcial: o armazenamento é maior que o lido)" : ""}</span>
      </p>
      <div role="progressbar" aria-label="Uso do armazenamento" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uso.porcentagem}
        className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${uso.nivel === "normal" ? "bg-primary" : "bg-destructive"}`} style={{ width: `${uso.porcentagem}%` }} />
      </div>
      {uso.nivel !== "normal" && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {uso.nivel === "cheio"
              ? "O armazenamento passou dos 10 GB gratuitos: o excedente já é cobrado (cerca de US$ 0,015 por GB ao mês)."
              : `O armazenamento passou de ${formatarGb(uso.aviso)}. Acima de ${formatarGb(uso.limite)} passa a ser cobrado (cerca de US$ 0,015 por GB ao mês).`}
          </span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">Calculado em {dataHoraSaoPaulo(uso.calculadoEm)}; atualizado no máximo a cada hora.</p>
    </div>
  );
}
