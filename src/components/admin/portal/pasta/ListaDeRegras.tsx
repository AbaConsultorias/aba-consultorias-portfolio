"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import { Selo } from "@/components/admin/portal/empreendimentos/Selos";
import type { ProjetoDaPasta, RegraDePasta, TipoDeRegraDePasta } from "@/lib/portal/pasta/tipos";
import { Caixa, EditorDeDestino, MarcaAprovado, SeletorDeTipo } from "./campos";
import { comCategoriaSugerida, destinoCompletoDoTipo, destinoDaRegra, ehTipoDeEtapa, rotuloCurtoDoDestino, SEM_DESTINO, type Destino } from "./destino";
import { Migalhas } from "./Migalhas";

type Props = { adminPath: string; regras: RegraDePasta[]; projetos: ProjetoDaPasta[]; ehAdmin: boolean; aoAvisar: (mensagem: string) => void };
type Modo = "ver" | "editar" | "remover";

export function ListaDeRegras({ adminPath, regras, projetos, ehAdmin, aoAvisar }: Props) {
  if (regras.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma regra ainda. Use “Sugerir regras” ou adicione uma manualmente.</p>;
  }
  return (
    <ul className="space-y-2">
      {regras.map((regra) => (
        <li key={regra.id}><LinhaDeRegra adminPath={adminPath} regra={regra} projetos={projetos} ehAdmin={ehAdmin} aoAvisar={aoAvisar} /></li>
      ))}
    </ul>
  );
}

function LinhaDeRegra({ adminPath, regra, projetos, ehAdmin, aoAvisar }: { adminPath: string; regra: RegraDePasta; projetos: ProjetoDaPasta[]; ehAdmin: boolean; aoAvisar: (mensagem: string) => void }) {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("ver");
  const [tipo, setTipo] = useState<TipoDeRegraDePasta>(regra.tipo);
  const [destino, setDestino] = useState<Destino>(destinoDaRegra(regra));
  const [liberar, setLiberar] = useState(regra.liberarAutomatico);
  const [marca, setMarca] = useState(regra.sinal === "aprovado");
  const [ativa, setAtiva] = useState(regra.ativa);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  // Regra ligada publica sozinha para o cliente: mudar ou apagar é só do admin.
  const travada = regra.liberarAutomatico && !ehAdmin;
  const mostraMarca = tipo === "comum" && destino.projetoId !== null;
  // Os PDFs de "Outros projetos" ficam ocultos até a equipe liberar: sem liberação automática.
  const aceitaLiberacaoAutomatica = !ehTipoDeEtapa(tipo) && destino.grupo !== "arquivo";

  function abrirEdicao() {
    setTipo(regra.tipo);
    setDestino(destinoDaRegra(regra));
    setLiberar(regra.liberarAutomatico);
    setMarca(regra.sinal === "aprovado");
    setAtiva(regra.ativa);
    setErro("");
    setModo("editar");
  }

  async function salvar() {
    if (destino.grupo === "arquivo" && (destino.rotulo ?? "").trim() === "") {
      setErro("Informe o rótulo do cartão.");
      return;
    }
    if (!destinoCompletoDoTipo(destino, tipo)) {
      setErro("Escolha o destino.");
      return;
    }
    setOcupado(true);
    setErro("");
    const resposta = await chamarPortal(adminPath, "pasta-regras", "PATCH", {
      id: regra.id, tipo, ...destino, ...(mostraMarca ? { marcaAprovado: marca } : {}),
      ...(ehAdmin ? { liberarAutomatico: liberar && aceitaLiberacaoAutomatica } : {}), ativa,
    });
    setOcupado(false);
    if (!resposta.ok) {
      setErro(resposta.erro ?? "Não foi possível salvar.");
      return;
    }
    setModo("ver");
    aoAvisar("Regra salva.");
    router.refresh();
  }

  async function remover() {
    setOcupado(true);
    setErro("");
    const resposta = await chamarPortal(adminPath, "pasta-regras", "DELETE", { id: regra.id });
    setOcupado(false);
    if (!resposta.ok) {
      setErro(resposta.erro ?? "Não foi possível remover.");
      return;
    }
    aoAvisar("Regra removida.");
    router.refresh();
  }

  return (
    <div className="min-w-0 rounded-xl border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Migalhas caminho={regra.caminhoPrefixo} />
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom="info"><ArrowRight className="size-3" aria-hidden="true" /><span className="sr-only">Destino: </span>{rotuloCurtoDoDestino(destinoDaRegra(regra), projetos, regra.tipo)}</Selo>
            {regra.liberarAutomatico ? <Selo tom="ok">Liberação automática</Selo> : <Selo tom="neutro">Oculta até liberar</Selo>}
            {regra.tipo === "protocolos" && <Selo tom="info">Marca “Em análise”</Selo>}
            {regra.tipo === "devolutivas" && <Selo tom="info">Marca “Em confecção”</Selo>}
            {regra.sinal === "aprovado" && <Selo tom="info">Marca “Aprovado”</Selo>}
            {!regra.ativa && <Selo tom="aviso">Inativa</Selo>}
          </div>
        </div>
        {modo === "ver" && !travada && (
          <div className="-mr-2 flex shrink-0">
            <Button type="button" variant="ghost" className="size-10" aria-label={`Editar regra ${regra.caminhoPrefixo}`} title="Editar" onClick={abrirEdicao}><Pencil aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" className="size-10 text-destructive hover:text-destructive" aria-label={`Remover regra ${regra.caminhoPrefixo}`} title="Remover" onClick={() => { setErro(""); setModo("remover"); }}><Trash2 aria-hidden="true" /></Button>
          </div>
        )}
      </div>

      {modo === "ver" && travada && (
        <p className="mt-2 text-sm text-muted-foreground">Esta regra libera sozinha para o cliente: só o administrador altera ou remove.</p>
      )}

      {modo === "editar" && (
        <div className="mt-4 space-y-4 border-t pt-4">
          <SeletorDeTipo id={`regra-${regra.id}`} valor={tipo} aoMudar={(novo) => {
            setTipo(novo);
            const comProjeto = destino.projetoId !== null;
            setDestino(novo === "equipamentos" && comProjeto ? { ...destino, categoriaId: null, grupo: null } : ehTipoDeEtapa(novo) && comProjeto ? comCategoriaSugerida({ ...destino, grupo: null }, novo, projetos) : SEM_DESTINO);
          }} desabilitado={ocupado} />
          <EditorDeDestino id={`regra-${regra.id}`} valor={destino} aoMudar={(novo) => setDestino(comCategoriaSugerida(novo, tipo, projetos))} projetos={projetos} desabilitado={ocupado} somenteProjeto={tipo === "equipamentos"} semGrupos={ehTipoDeEtapa(tipo)} />
          {mostraMarca && <MarcaAprovado marcada={marca} aoMudar={setMarca} desabilitada={ocupado} />}
          <div className="space-y-2">
            {ehAdmin && aceitaLiberacaoAutomatica && <Caixa marcada={liberar} aoMudar={setLiberar} desabilitada={ocupado}>Liberar automático</Caixa>}
            <Caixa marcada={ativa} aoMudar={setAtiva} desabilitada={ocupado}>Regra ativa</Caixa>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="portal-botao" disabled={ocupado} onClick={salvar}><Check aria-hidden="true" />{ocupado ? "Salvando…" : "Salvar"}</Button>
            <Button type="button" variant="outline" className="portal-botao" disabled={ocupado} onClick={() => setModo("ver")}><X aria-hidden="true" />Cancelar</Button>
          </div>
        </div>
      )}

      {modo === "remover" && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <p className="text-sm">Remover esta regra? Os documentos que já chegaram por ela continuam no portal; novos arquivos desta pasta deixam de ser enviados.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" className="portal-botao" disabled={ocupado} onClick={remover}><Check aria-hidden="true" />{ocupado ? "Removendo…" : "Confirmar remoção"}</Button>
            <Button type="button" variant="outline" className="portal-botao" disabled={ocupado} onClick={() => setModo("ver")}><X aria-hidden="true" />Cancelar</Button>
          </div>
        </div>
      )}

      <MensagemDeErro>{erro}</MensagemDeErro>
    </div>
  );
}
