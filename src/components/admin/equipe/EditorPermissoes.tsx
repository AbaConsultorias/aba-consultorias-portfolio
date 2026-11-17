"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AREAS, MODELOS } from "@/lib/auth/permissoes";
import {
  alternar,
  aplicarModelo,
  areaCompleta,
  limparArea,
  liberarArea,
  mesmaSelecao,
  paraLista,
  selecaoDe,
  type Selecao,
} from "@/lib/auth/permissoes-selecao";
import { chamarEquipe } from "./chamarEquipe";

type Props = {
  adminPath: string;
  contaId: string;
  permissoes: readonly string[];
};

export function EditorPermissoes({ adminPath, contaId, permissoes }: Props) {
  const router = useRouter();
  const [salvas, setSalvas] = useState<Selecao>(() => selecaoDe(permissoes));
  const [selecao, setSelecao] = useState<Selecao>(salvas);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null);
  const alterado = !mesmaSelecao(selecao, salvas);

  function mudar(proxima: Selecao) {
    setSelecao(proxima);
    setMensagem(null);
  }

  async function salvar() {
    setSalvando(true);
    setMensagem(null);
    const resposta = await chamarEquipe(adminPath, `/${contaId}/permissoes`, "PUT", { permissoes: paraLista(selecao) });
    setSalvando(false);
    if (!resposta.ok) {
      setMensagem({ texto: resposta.erro, erro: true });
      return;
    }
    setSalvas(selecao);
    setMensagem({ texto: "Permissões salvas.", erro: false });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Conta nova começa sem nenhum acesso. Marque o que esta pessoa pode fazer; nada vale até tocar em Salvar.
        Marcar uma opção marca também a que ela exige (editar exige ver), e tirar a exigida tira as que dependem dela.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Preencher rápido:</span>
        {MODELOS.map((modelo) => (
          <Button key={modelo.id} type="button" variant="outline" className="min-h-11" onClick={() => mudar(aplicarModelo(selecao, modelo.id))}>
            {modelo.rotulo}
          </Button>
        ))}
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => mudar(selecaoDe([]))}>
          Limpar tudo
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {AREAS.map((area) => {
          const completa = areaCompleta(selecao, area.id);
          return (
            <fieldset key={area.id} className="min-w-0 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{area.rotulo}</legend>
              {area.permissoes.map(({ permissao, rotulo }) => (
                <label key={permissao} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={selecao.has(permissao)}
                    onChange={() => mudar(alternar(selecao, permissao))} />
                  <span className="min-w-0 break-words">{rotulo}</span>
                </label>
              ))}
              <Button type="button" variant="ghost" className="min-h-11 px-2"
                onClick={() => mudar(completa ? limparArea(selecao, area.id) : liberarArea(selecao, area.id))}>
                {completa ? "Tirar tudo desta área" : "Liberar tudo desta área"}
              </Button>
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="min-h-11" disabled={salvando || !alterado} onClick={salvar}>
          <Save aria-hidden="true" />
          {salvando ? "Salvando…" : "Salvar permissões"}
        </Button>
        {alterado && !salvando && <span className="text-sm text-muted-foreground">Há mudanças ainda não salvas.</span>}
        <p aria-live="polite" className={mensagem?.erro ? "text-sm text-destructive" : "text-sm"}>{mensagem?.texto}</p>
      </div>
    </div>
  );
}
