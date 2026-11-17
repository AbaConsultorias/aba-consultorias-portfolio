"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chamarApi } from "./cliente-api";
import { MensagemDeErro } from "./campos";

type Item = { id: string; conteudo: React.ReactNode };

type Props = {
  adminPath: string;
  // Rota que recebe PUT { ids } com a lista completa na nova ordem, relativa a /api/conteudo/.
  caminhoOrdem: string;
  rotulo: string;
  itens: Item[];
};

// Reordena com botões de subir/descer (funciona no celular, sem arrastar).
export function ListaOrdenavel({ adminPath, caminhoOrdem, rotulo, itens }: Props) {
  const [ordem, setOrdem] = useState(() => itens.map((item) => item.id));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const porId = new Map(itens.map((item) => [item.id, item]));
  const ids = [...ordem.filter((id) => porId.has(id)), ...itens.map((item) => item.id).filter((id) => !ordem.includes(id))];

  async function mover(indice: number, deslocamento: -1 | 1) {
    const destino = indice + deslocamento;
    const nova = [...ids];
    [nova[indice], nova[destino]] = [nova[destino], nova[indice]];

    const anterior = ids;
    setOrdem(nova);
    setSalvando(true);
    setErro(null);

    const resposta = await chamarApi(adminPath, caminhoOrdem, "PUT", { ids: nova });
    setSalvando(false);

    if (!resposta.ok) {
      setOrdem(anterior);
      setErro(resposta.erro);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <MensagemDeErro>{erro}</MensagemDeErro>
      <ol aria-label={rotulo} className="flex flex-col gap-2">
        {ids.map((id, indice) => (
          <li key={id} className="flex items-stretch gap-2 rounded-xl border border-border bg-card p-2">
            <div className="flex flex-col justify-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={`Subir ${indice + 1}º item`}
                disabled={salvando || indice === 0}
                onClick={() => mover(indice, -1)}
              >
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={`Descer ${indice + 1}º item`}
                disabled={salvando || indice === ids.length - 1}
                onClick={() => mover(indice, 1)}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </div>
            <div className="min-w-0 flex-1">{porId.get(id)?.conteudo}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
