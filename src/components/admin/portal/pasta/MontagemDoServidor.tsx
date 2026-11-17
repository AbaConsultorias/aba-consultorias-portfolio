"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed, FolderTree, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemDeErro, Select } from "@/components/admin/comum/campos";
import { chamarPortal } from "@/components/admin/portal/documentos/api";
import type { EstadoDoItem, ItemDaMontagem, Montagem, RegraDerivada, SlotDaMontagem } from "@/lib/conector/montagem";
import type { PreviaDaMontagem, ResumoDaMontagem } from "@/lib/portal/pasta/tipos";
import { Caixa } from "./campos";
import { Migalhas } from "./Migalhas";

type Escolha = { marcado: boolean; caminhos: string[] };
type Escolhas = Record<string, Escolha>;
type Props = {
  adminPath: string;
  empreendimentoId: string;
  // Montar exige empreendimentos.editar e servidor.regras; a chave dos complementares, só empreendimentos.editar.
  podeMontar: boolean;
  podeEditar: boolean;
  ehAdmin: boolean;
  lerComplementares: boolean;
  aoAvisar: (mensagem: string) => void;
};

const ESTADOS: Record<EstadoDoItem, { rotulo: string; Icone: LucideIcon; classe: string }> = {
  encontrado: { rotulo: "Encontrado", Icone: CircleCheck, classe: "text-primary" },
  parcial: { rotulo: "Encontrado, falta a subpasta", Icone: TriangleAlert, classe: "text-amber-700 dark:text-amber-400" },
  ambiguo: { rotulo: "Mais de uma pasta: escolha", Icone: TriangleAlert, classe: "text-amber-700 dark:text-amber-400" },
  ausente: { rotulo: "Não encontrado", Icone: CircleDashed, classe: "text-muted-foreground" },
  ja_criado: { rotulo: "Já criado", Icone: CircleCheck, classe: "text-muted-foreground" },
  indisponivel: { rotulo: "Indisponível", Icone: TriangleAlert, classe: "text-destructive" },
};
const PODE_MARCAR: ReadonlySet<EstadoDoItem> = new Set(["encontrado", "parcial", "ambiguo"]);

function escolhasIniciais(montagem: Montagem): Escolhas {
  return Object.fromEntries(montagem.itens.map((item) => [item.id, { marcado: item.marcado, caminhos: item.slots.map((slot) => slot.escolhida ?? "") }]));
}

// Regras de protocolos e devolutivas que a escolha atual cria (as que já existem não entram).
function derivadasPendentes(slot: SlotDaMontagem, caminho: string | null | undefined): RegraDerivada[] {
  return caminho ? (slot.derivadas[caminho] ?? []).filter((regra) => !regra.jaCriada) : [];
}

function contarSelecao(montagem: Montagem, escolhas: Escolhas) {
  let projetos = 0;
  let regras = 0;
  let regrasDeEtapa = 0;
  const faltaEscolher: string[] = [];
  for (const item of montagem.itens) {
    const escolha = escolhas[item.id];
    if (!escolha?.marcado || !PODE_MARCAR.has(item.estado)) continue;
    if (item.tipo === "projeto" && !item.projetoJaExiste) projetos += 1;
    item.slots.forEach((slot, indice) => {
      if (slot.estado === "ausente") return;
      regrasDeEtapa += derivadasPendentes(slot, slot.jaCriada ? slot.escolhida : escolha.caminhos[indice]).length;
      if (slot.jaCriada) return;
      if (escolha.caminhos[indice]) regras += 1;
      else faltaEscolher.push(item.rotulo);
    });
  }
  return { projetos, regras: regras + regrasDeEtapa, regrasDeEtapa, faltaEscolher: [...new Set(faltaEscolher)] };
}

function RegrasDeEtapa({ slot, caminho }: { slot: SlotDaMontagem; caminho: string | null | undefined }) {
  const derivadas = caminho ? slot.derivadas[caminho] ?? [] : [];
  if (derivadas.length === 0) return null;
  return (
    <ul className="min-w-0 space-y-1.5 border-l-2 pl-3" aria-label="Regras que marcam a etapa">
      {derivadas.map((regra) => (
        <li key={regra.caminho} className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{regra.rotulo}{regra.jaCriada ? <span className="font-normal text-muted-foreground"> · já tem regra</span> : null}</p>
          <Migalhas caminho={regra.caminho} />
        </li>
      ))}
    </ul>
  );
}

function Estado({ estado }: { estado: EstadoDoItem }) {
  const { rotulo, Icone, classe } = ESTADOS[estado];
  return <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${classe}`}><Icone className="size-4 shrink-0" aria-hidden="true" />{rotulo}</span>;
}

// Chave acessível (role="switch"): o componente de interruptor do shadcn não está instalado neste projeto.
function Interruptor({ ligado, aoMudar, desabilitado, rotulo, ajudaId }: { ligado: boolean; aoMudar: (ligado: boolean) => void; desabilitado: boolean; rotulo: string; ajudaId: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-describedby={ajudaId} disabled={desabilitado} onClick={() => aoMudar(!ligado)}
      className="inline-flex min-h-11 items-center gap-3 rounded-lg text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50">
      <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${ligado ? "border-primary bg-primary" : "border-input bg-muted"}`}>
        <span className={`inline-block size-4 rounded-full bg-background shadow transition-transform ${ligado ? "translate-x-6" : "translate-x-1"}`} />
      </span>
      <span>{rotulo}<span className="sr-only">: {ligado ? "ligada" : "desligada"}</span></span>
    </button>
  );
}

export function MontagemDoServidor({ adminPath, empreendimentoId, podeMontar, podeEditar, ehAdmin, lerComplementares, aoAvisar }: Props) {
  const router = useRouter();
  const [ligado, setLigado] = useState(lerComplementares);
  const [previa, setPrevia] = useState<PreviaDaMontagem | null>(null);
  const [escolhas, setEscolhas] = useState<Escolhas>({});
  const [ocupado, setOcupado] = useState<"previa" | "chave" | "criar" | "orfa" | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resumo, setResumo] = useState<ResumoDaMontagem | null>(null);
  const [erro, setErro] = useState("");
  const [erroDaChave, setErroDaChave] = useState("");
  const [erroDaOrfa, setErroDaOrfa] = useState("");

  async function carregar(): Promise<void> {
    setOcupado("previa");
    setErro("");
    const resposta = await chamarPortal<PreviaDaMontagem>(adminPath, `pasta-montagem?empreendimentoId=${empreendimentoId}`, "GET");
    setOcupado(null);
    if (!resposta.ok || !resposta.details) {
      setErro(resposta.erro ?? "Não foi possível ler as pastas.");
      return;
    }
    setPrevia(resposta.details);
    if (resposta.details.situacao === "ok") {
      setEscolhas(escolhasIniciais(resposta.details.montagem));
      setLigado(resposta.details.montagem.lerComplementares);
    }
  }

  async function mudarChave(novo: boolean) {
    setOcupado("chave");
    setErroDaChave("");
    const resposta = await chamarPortal(adminPath, "pasta-montagem/complementares", "PATCH", { empreendimentoId, lerComplementares: novo });
    setOcupado(null);
    if (!resposta.ok) {
      setErroDaChave(resposta.erro ?? "Não foi possível salvar.");
      return;
    }
    setLigado(novo);
    aoAvisar(novo ? "Leitura dos projetos complementares ligada." : "Leitura dos projetos complementares desligada.");
    router.refresh();
    if (previa) await carregar();
  }

  async function criar(montagem: Montagem) {
    setOcupado("criar");
    setErro("");
    const itens = montagem.itens.flatMap((item) => {
      const escolha = escolhas[item.id];
      if (!escolha?.marcado || !PODE_MARCAR.has(item.estado)) return [];
      const caminhos = item.slots.flatMap((slot, indice) => (slot.jaCriada || slot.estado === "ausente" || !escolha.caminhos[indice] ? [] : [escolha.caminhos[indice]]));
      return [{ chave: item.chave, sistema: item.sistema, caminhos }];
    });
    const resposta = await chamarPortal<ResumoDaMontagem>(adminPath, "pasta-montagem", "POST", { empreendimentoId, itens });
    setOcupado(null);
    setConfirmando(false);
    if (!resposta.ok || !resposta.details) {
      setErro(resposta.erro ?? "Não foi possível criar. Nada foi alterado.");
      return;
    }
    setResumo(resposta.details);
    aoAvisar(`${resposta.details.projetosCriados} projeto(s) e ${resposta.details.regrasCriadas + resposta.details.regrasDeEtapaCriadas} regra(s) criado(s).`);
    router.refresh();
    await carregar();
  }

  async function trocarCaminho(regraId: string, caminho: string) {
    setOcupado("orfa");
    setErroDaOrfa("");
    const resposta = await chamarPortal(adminPath, "pasta-regras", "PATCH", { id: regraId, caminhoPrefixo: caminho });
    setOcupado(null);
    if (!resposta.ok) {
      setErroDaOrfa(resposta.erro ?? "Não foi possível trocar o caminho.");
      return;
    }
    aoAvisar("Caminho da regra atualizado.");
    router.refresh();
    await carregar();
  }

  function mudarItem(id: string, mudanca: Partial<Escolha>) {
    setResumo(null);
    setConfirmando(false);
    setEscolhas((atuais) => ({ ...atuais, [id]: { ...atuais[id], ...mudanca } }));
  }

  function mudarCaminho(item: ItemDaMontagem, indice: number, caminho: string) {
    const atuais = escolhas[item.id]?.caminhos ?? item.slots.map(() => "");
    mudarItem(item.id, { caminhos: atuais.map((atual, posicao) => (posicao === indice ? caminho : atual)) });
  }

  const montagem = previa?.situacao === "ok" ? previa.montagem : null;
  const contagem = montagem ? contarSelecao(montagem, escolhas) : null;

  function grupo(titulo: string, itens: ItemDaMontagem[]) {
    if (itens.length === 0) return null;
    return (
      <section aria-label={titulo} className="min-w-0 space-y-3">
        <h4 className="text-base font-medium">{titulo}</h4>
        <ul className="space-y-3">
          {itens.map((item) => {
            const escolha = escolhas[item.id] ?? { marcado: false, caminhos: item.slots.map(() => "") };
            const marcavel = PODE_MARCAR.has(item.estado);
            return (
              <li key={item.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  {marcavel ? (
                    <Caixa marcada={escolha.marcado} aoMudar={(marcado) => mudarItem(item.id, { marcado })} desabilitada={ocupado !== null}>
                      <span className="font-medium">{item.rotulo}{item.sistema ? ` (${item.sistema})` : ""}</span>
                    </Caixa>
                  ) : (
                    <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.rotulo}{item.sistema ? ` (${item.sistema})` : ""}</p>
                  )}
                  <Estado estado={item.estado} />
                </div>
                {item.nomeProjeto && item.estado !== "ausente" && (
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">Projeto: <span className="text-foreground">{item.nomeProjeto}</span>{item.projetoJaExiste ? " (já existe)" : ""}</p>
                )}
                {item.estado !== "ausente" && item.tipo === "projeto" && !item.criaRegras && item.pasta && (
                  <div className="min-w-0 space-y-1">
                    <Migalhas caminho={item.pasta} />
                    <p className="text-sm text-muted-foreground">Sem regra própria: os arquivos desta pasta continuam indo para {item.precisaDe ? `“${item.precisaDe.rotulo}”` : "o outro projeto"}.</p>
                  </div>
                )}
                {item.estado !== "ausente" && item.tipo === "arquivo" && (
                  <p className="text-sm text-muted-foreground">Não vira projeto: os PDFs ficam guardados, ocultos, em “Outros projetos” até a equipe liberar.</p>
                )}
                {item.estado !== "ausente" && item.slots.map((slot, indice) => (
                  <div key={indice} className="min-w-0 space-y-1.5">
                    {slot.estado === "ausente" && <p className="text-sm text-muted-foreground">Subpasta aprovada não encontrada.</p>}
                    {slot.estado === "encontrada" && slot.escolhida && (
                      <div className="min-w-0 space-y-1">
                        <Migalhas caminho={slot.escolhida} />
                        {slot.jaCriada && <p className="text-sm text-muted-foreground">Já tem regra.</p>}
                        <RegrasDeEtapa slot={slot} caminho={slot.escolhida} />
                      </div>
                    )}
                    {slot.estado === "ambigua" && (
                      <div className="min-w-0 space-y-1.5">
                        <label htmlFor={`montagem-${item.id}-${indice}`} className="text-sm font-medium">Escolha a pasta</label>
                        <Select id={`montagem-${item.id}-${indice}`} value={escolha.caminhos[indice] ?? ""} disabled={ocupado !== null}
                          onChange={(evento) => mudarCaminho(item, indice, evento.target.value)}>
                          <option value="">Escolha a pasta</option>
                          {slot.candidatas.map((candidata) => <option key={candidata} value={candidata}>{candidata}</option>)}
                        </Select>
                        <RegrasDeEtapa slot={slot} caminho={escolha.caminhos[indice]} />
                      </div>
                    )}
                  </div>
                ))}
                {item.avisos.map((aviso) => <p key={aviso} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{aviso}</p>)}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="min-w-0 space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h3 className="text-lg font-medium">Montar a partir do servidor</h3>
        <p className="text-sm text-muted-foreground">O site compara as pastas do servidor com o catálogo e sugere os projetos e as regras deste empreendimento. Nada é criado antes de você confirmar, e as regras nascem ocultas.</p>
        {ehAdmin && (
          <Link href={`/${adminPath}/portal/catalogo-pastas`} prefetch={false} className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            Editar o catálogo de pastas
          </Link>
        )}
      </div>

      <div className="min-w-0 space-y-1 rounded-lg border p-4">
        {podeEditar ? (
          <Interruptor ligado={ligado} aoMudar={mudarChave} desabilitado={ocupado !== null} rotulo="Ler projetos complementares" ajudaId="montagem-complementares-ajuda" />
        ) : (
          <p className="text-sm font-medium">Ler projetos complementares: {ligado ? "ligada" : "desligada"}</p>
        )}
        <p id="montagem-complementares-ajuda" className="text-sm text-muted-foreground">Ligue depois que o SAA ou o SES for aprovado. Desligada, PER, PEC, Descrição Topográfica e Estruturais não entram na lista.</p>
        <MensagemDeErro>{erroDaChave}</MensagemDeErro>
      </div>

      {podeMontar && (
        <Button type="button" variant="outline" className="portal-botao" disabled={ocupado !== null} onClick={carregar}>
          <FolderTree aria-hidden="true" />{ocupado === "previa" ? "Lendo as pastas…" : previa ? "Atualizar a lista" : "Montar a partir do servidor"}
        </Button>
      )}
      <MensagemDeErro>{erro}</MensagemDeErro>

      {previa && previa.situacao !== "ok" && (
        <p className="text-sm text-muted-foreground" role="status">
          {previa.situacao === "sem-codigo"
            ? "Informe e salve o código da pasta acima para o programa do servidor poder listar as pastas deste empreendimento."
            : "O programa do servidor ainda não informou as pastas deste código. Pode levar até 30 minutos depois de vincular ou renomear uma pasta."}
        </p>
      )}

      {montagem && contagem && (
        <div className="min-w-0 space-y-6">
          {grupo("Base", montagem.itens.filter((item) => item.fase === "base"))}
          {ligado && grupo("Complementares", montagem.itens.filter((item) => item.fase === "complementar"))}

          {montagem.pastasDesconhecidas.length > 0 && (
            <section aria-label="Pastas desconhecidas" className="min-w-0 space-y-2">
              <h4 className="flex items-center gap-2 text-base font-medium"><TriangleAlert className="size-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />Pastas desconhecidas</h4>
              <p className="text-sm text-muted-foreground">Estas pastas não combinam com nenhum item do catálogo e não geram nada.</p>
              <ul className="space-y-1">
                {montagem.pastasDesconhecidas.map((pasta) => <li key={pasta} className="min-w-0"><Migalhas caminho={pasta} /></li>)}
              </ul>
            </section>
          )}

          {montagem.orfas.length > 0 && (
            <section aria-label="Regras órfãs" className="min-w-0 space-y-3">
              <h4 className="text-base font-medium">Regras órfãs</h4>
              <p className="text-sm text-muted-foreground">A pasta destas regras não está mais na lista do servidor (foi renomeada ou apagada), então elas não casam com nada.</p>
              <ul className="space-y-3">
                {montagem.orfas.map((orfa) => (
                  <li key={orfa.regraId} className="min-w-0 space-y-2 rounded-xl border p-4">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm text-muted-foreground">Caminho atual</p>
                      <Migalhas caminho={orfa.caminhoAtual} />
                    </div>
                    {orfa.sugestao ? (
                      <div className="min-w-0 space-y-2">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm text-muted-foreground">Caminho novo{orfa.rotulo ? ` (${orfa.rotulo})` : ""}</p>
                          <Migalhas caminho={orfa.sugestao} />
                        </div>
                        <Button type="button" variant="outline" className="portal-botao" disabled={ocupado !== null} onClick={() => trocarCaminho(orfa.regraId, orfa.sugestao ?? "")}>Trocar pelo caminho novo</Button>
                      </div>
                    ) : <p className="text-sm text-muted-foreground">Não há pasta nova sem regra para ela. Ajuste ou apague esta regra em Regras de pasta.</p>}
                  </li>
                ))}
              </ul>
              <MensagemDeErro>{erroDaOrfa}</MensagemDeErro>
            </section>
          )}

          <div className="min-w-0 space-y-3 border-t pt-4">
            {contagem.faltaEscolher.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400" role="status">Escolha a pasta de {contagem.faltaEscolher.join(", ")} ou desmarque o item.</p>}
            {!confirmando ? (
              <Button type="button" className="portal-botao" disabled={ocupado !== null || (contagem.projetos === 0 && contagem.regras === 0) || contagem.faltaEscolher.length > 0} onClick={() => setConfirmando(true)}>Criar selecionados</Button>
            ) : (
              <div role="alertdialog" aria-labelledby="montagem-confirmar" className="min-w-0 space-y-3 rounded-lg border p-4">
                <p id="montagem-confirmar" className="text-sm">
                  Vai criar {contagem.projetos} projeto(s) e {contagem.regras} regra(s) de pasta{contagem.regrasDeEtapa > 0 ? ` (${contagem.regrasDeEtapa} de protocolos e devolutivas, que marcam a etapa)` : ""}, todas ocultas (sem liberação automática). Se algo falhar na criação dos projetos e das regras comuns, nada é criado; as regras de protocolos e devolutivas são criadas em seguida e as que falharem podem ser refeitas.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="portal-botao" disabled={ocupado !== null} onClick={() => criar(montagem)}>{ocupado === "criar" ? "Criando…" : "Confirmar e criar"}</Button>
                  <Button type="button" variant="outline" className="portal-botao" disabled={ocupado !== null} onClick={() => setConfirmando(false)}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {resumo && (
        <div role="status" className="min-w-0 space-y-1 rounded-lg border p-4 text-sm">
          <p className="font-medium">Montagem concluída</p>
          <p>{resumo.projetosCriados} projeto(s) criado(s), {resumo.projetosReaproveitados} reaproveitado(s) e {resumo.regrasCriadas} regra(s) criada(s).</p>
          {(resumo.regrasDeEtapaCriadas > 0 || resumo.regrasDeEtapaPuladas > 0) && (
            <p>{resumo.regrasDeEtapaCriadas} regra(s) de protocolos e devolutivas criada(s){resumo.regrasDeEtapaPuladas > 0 ? `; ${resumo.regrasDeEtapaPuladas} não pôde(ram) ser criada(s). Use “Atualizar a lista” e confirme de novo` : ""}.</p>
          )}
          {resumo.ignorados.length > 0 && <p className="text-muted-foreground">{resumo.ignorados.length} item(ns) já existiam e foram pulados.</p>}
        </div>
      )}
    </div>
  );
}
