import { ROTULO_DO_MODO, type EtapasDoProjeto } from "@/lib/portal/etapas/tipos";
import { CartaoDeSugestao } from "./CartaoDeSugestao";
import { HistoricoDeEtapas } from "./HistoricoDeEtapas";

type Props = { adminPath: string; projetoId: string; dados: EtapasDoProjeto; podeEditar: boolean };

// Só a equipe vê isto (página do projeto no painel): o cliente nunca recebe sinal, histórico nem nome de arquivo.
export function SecaoEtapasDoProjeto({ adminPath, projetoId, dados, podeEditar }: Props) {
  return (
    <section aria-labelledby="titulo-etapas-pastas" className="min-w-0 space-y-4">
      <div className="space-y-1">
        <h2 id="titulo-etapas-pastas" className="text-xl font-medium">Etapas pelas pastas</h2>
        <p className="text-sm text-muted-foreground">
          Modo deste empreendimento: {ROTULO_DO_MODO[dados.modo]}.{" "}
          {dados.modo === "desligado" ? "Ligue na aba “Pasta do servidor” do empreendimento para receber sugestões." : "O cliente só vê a etapa nova depois de confirmada."}
        </p>
      </div>
      {dados.sugestao && <CartaoDeSugestao adminPath={adminPath} projetoId={projetoId} sugestao={dados.sugestao} podeEditar={podeEditar} />}
      <div className="space-y-2">
        <h3 className="text-base font-medium">Histórico das mudanças de etapa</h3>
        <HistoricoDeEtapas adminPath={adminPath} historico={dados.historico} />
      </div>
    </section>
  );
}
