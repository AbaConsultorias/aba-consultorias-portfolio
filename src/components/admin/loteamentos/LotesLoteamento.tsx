"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { chamarApi } from "@/components/admin/comum/cliente-api";
import { ConfirmarExclusao } from "@/components/admin/comum/ConfirmarExclusao";
import type { StatusLote } from "@/lib/conteudo/tipos";
import { cn } from "@/lib/utils";
import type { LoteAdmin } from "./consultas";
import { FormularioLote } from "./FormularioLote";
import { LotesEmMassa } from "./LotesEmMassa";
import { MapaInterativo } from "./MapaInterativo";
import { CLASSE_STATUS_ATIVO, formatarArea, ORDEM_STATUS, ROTULO_STATUS } from "./status";

type Props = {
  adminPath: string;
  loteamentoId: string;
  mapaUrl: string | null;
  lotes: LoteAdmin[];
};

const POR_PAGINA = 100;

function SeletorDeStatus({
  rotulo,
  valor,
  aoEscolher,
}: {
  rotulo: string;
  valor: StatusLote;
  aoEscolher: (status: StatusLote) => void;
}) {
  return (
    <div role="group" aria-label={`Situação de ${rotulo}`} className="inline-flex overflow-hidden rounded-lg border border-input">
      {ORDEM_STATUS.map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={valor === status}
          onClick={() => aoEscolher(status)}
          className={cn(
            "min-h-9 border-l border-input px-2.5 text-xs font-medium outline-none transition-colors first:border-l-0 focus-visible:relative focus-visible:ring-3 focus-visible:ring-ring/50",
            valor === status ? CLASSE_STATUS_ATIVO[status] : "bg-background hover:bg-muted",
          )}
        >
          {ROTULO_STATUS[status]}
        </button>
      ))}
    </div>
  );
}

export function LotesLoteamento({ adminPath, loteamentoId, mapaUrl, lotes: inicial }: Props) {
  const router = useRouter();
  const [lotes, setLotes] = useState(inicial);
  const [pincel, setPincel] = useState<StatusLote>("vendido");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusLote | "todos">("todos");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [painel, setPainel] = useState<"nenhum" | "novo" | "massa">("nenhum");
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const totais = useMemo(() => {
    const contagem: Record<StatusLote, number> = { disponivel: 0, vendido: 0, area_tecnica: 0 };
    for (const lote of lotes) contagem[lote.status] += 1;
    return contagem;
  }, [lotes]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lotes.filter(
      (lote) =>
        (filtroStatus === "todos" || lote.status === filtroStatus) &&
        (termo === "" || `${lote.quadra} ${lote.numero} ${lote.svgId ?? ""}`.toLowerCase().includes(termo)),
    );
  }, [lotes, busca, filtroStatus]);

  function trocarLocal(id: string, status: StatusLote) {
    setLotes((atuais) => atuais.map((lote) => (lote.id === id ? { ...lote, status } : lote)));
  }

  async function mudarStatus(lote: LoteAdmin, status: StatusLote) {
    if (lote.status === status) return;

    setErro(null);
    setAviso(null);
    trocarLocal(lote.id, status);

    const resposta = await chamarApi(adminPath, `lotes/${lote.id}`, "PATCH", { status });
    if (!resposta.ok) {
      trocarLocal(lote.id, lote.status);
      setErro(`Não foi possível mudar o lote ${lote.quadra}-${lote.numero}: ${resposta.erro}`);
    }
  }

  async function excluir(lote: LoteAdmin) {
    const resposta = await chamarApi(adminPath, `lotes/${lote.id}`, "DELETE");
    if (!resposta.ok) return resposta.erro;

    setLotes((atuais) => atuais.filter((atual) => atual.id !== lote.id));
    router.refresh();
    return null;
  }

  function concluirEdicao(mensagem?: string) {
    setPainel("nenhum");
    setEditando(null);
    setAviso(mensagem ?? null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {mapaUrl && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="pincel-status" className="text-sm font-medium">
              Clicar em um lote do mapa marca como
            </label>
            <Select
              id="pincel-status"
              className="w-auto"
              value={pincel}
              onChange={(e) => setPincel(e.target.value as StatusLote)}
            >
              {ORDEM_STATUS.map((status) => (
                <option key={status} value={status}>
                  {ROTULO_STATUS[status]}
                </option>
              ))}
            </Select>
          </div>
          <MapaInterativo mapaUrl={mapaUrl} lotes={lotes} aoClicar={(lote) => mudarStatus(lote, pincel)} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" role="status">
          {lotes.length} {lotes.length === 1 ? "lote" : "lotes"}: {totais.disponivel} disponíveis, {totais.vendido}{" "}
          vendidos, {totais.area_tecnica} em área técnica.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => { setPainel("novo"); setEditando(null); }}>
            <Plus aria-hidden="true" />
            Adicionar lote
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setPainel("massa"); setEditando(null); }}>
            <Rows3 aria-hidden="true" />
            Adicionar vários
          </Button>
        </div>
      </div>

      {painel === "novo" && (
        <FormularioLote
          adminPath={adminPath}
          loteamentoId={loteamentoId}
          aoConcluir={() => concluirEdicao("Lote adicionado.")}
          aoCancelar={() => setPainel("nenhum")}
        />
      )}
      {painel === "massa" && (
        <LotesEmMassa
          adminPath={adminPath}
          loteamentoId={loteamentoId}
          aoConcluir={concluirEdicao}
          aoCancelar={() => setPainel("nenhum")}
        />
      )}

      {aviso && (
        <p role="status" className="text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
      <MensagemDeErro>{erro}</MensagemDeErro>

      {lotes.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <Input
            value={busca}
            placeholder="Buscar por quadra, número ou código"
            aria-label="Buscar lote"
            className="sm:max-w-xs"
            onChange={(e) => {
              setBusca(e.target.value);
              setLimite(POR_PAGINA);
            }}
          />
          <Select
            aria-label="Filtrar por situação"
            className="sm:w-auto"
            value={filtroStatus}
            onChange={(e) => {
              setFiltroStatus(e.target.value as StatusLote | "todos");
              setLimite(POR_PAGINA);
            }}
          >
            <option value="todos">Todas as situações</option>
            {ORDEM_STATUS.map((status) => (
              <option key={status} value={status}>
                {ROTULO_STATUS[status]}
              </option>
            ))}
          </Select>
        </div>
      )}

      {lotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lote cadastrado ainda.</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lote encontrado com esse filtro.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visiveis.slice(0, limite).map((lote) => (
            <li key={lote.id}>
              {editando === lote.id ? (
                <FormularioLote
                  adminPath={adminPath}
                  loteamentoId={loteamentoId}
                  lote={lote}
                  aoConcluir={() => concluirEdicao("Lote salvo.")}
                  aoCancelar={() => setEditando(null)}
                />
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      Quadra {lote.quadra} · Lote {lote.numero}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatarArea(lote.areaM2)}
                      {lote.svgId ? ` · mapa: ${lote.svgId}` : ""}
                    </p>
                    {lote.observacao && <p className="mt-1 text-sm">{lote.observacao}</p>}
                  </div>
                  <SeletorDeStatus
                    rotulo={`quadra ${lote.quadra}, lote ${lote.numero}`}
                    valor={lote.status}
                    aoEscolher={(status) => mudarStatus(lote, status)}
                  />
                  <div className="flex flex-wrap items-start gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Editar quadra ${lote.quadra}, lote ${lote.numero}`}
                      onClick={() => { setEditando(lote.id); setPainel("nenhum"); }}
                    >
                      <Pencil aria-hidden="true" />
                      Editar
                    </Button>
                    <ConfirmarExclusao
                      tamanho="sm"
                      aviso={`Excluir o lote ${lote.numero} da quadra ${lote.quadra}?`}
                      aoConfirmar={() => excluir(lote)}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {visiveis.length > limite && (
        <Button type="button" variant="outline" onClick={() => setLimite((atual) => atual + POR_PAGINA)}>
          Mostrar mais ({visiveis.length - limite} restantes)
        </Button>
      )}
    </div>
  );
}
