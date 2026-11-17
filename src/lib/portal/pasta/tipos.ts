import type { Montagem } from "@/lib/conector/montagem";
import type { GrupoDeDocumento } from "@/lib/conector/sugestoes";

// Pré-visualização de "Montar a partir do servidor" (GET pasta-montagem) e o resumo do que a montagem criou (POST).
export type PreviaDaMontagem =
  | { situacao: "sem-codigo" | "sem-arvore" }
  | { situacao: "ok"; montagem: Montagem; atualizadoEm: string | null };
export type ResumoDaMontagem = {
  projetosCriados: number;
  projetosReaproveitados: number;
  regrasCriadas: number;
  // Protocolos e devolutivas, criadas pelo site depois da função do banco; as puladas já existiam ou não acharam o projeto.
  regrasDeEtapaCriadas: number;
  regrasDeEtapaPuladas: number;
  ignorados: { chave: string; caminho: string; motivo: string }[];
};

// Modo "Etapas pelas pastas" do empreendimento (empreendimentos.etapas_modo).
export const MODOS_DE_ETAPAS = ["desligado", "sugerir", "automatico"] as const;
export type ModoDeEtapas = (typeof MODOS_DE_ETAPAS)[number];

// "equipamentos": SIMOS e Laudos por equipamento (uma subpasta por equipamento); o destino é só o projeto.
// "protocolos" (pasta PROJETOS) e "devolutivas" (pasta LAN): os PDFs marcam a etapa do projeto; o destino é o projeto.
export type TipoDeRegraDePasta = "comum" | "equipamentos" | "protocolos" | "devolutivas";
// O que o arquivo da regra significa para a etapa. "aprovado" só existe em regra comum de projeto.
export type SinalDaRegra = "protocolo" | "devolutiva" | "aprovado";

export type RegraDePasta = {
  id: string;
  empreendimentoId: string;
  caminhoPrefixo: string;
  tipo: TipoDeRegraDePasta;
  sinal: SinalDaRegra | null;
  projetoId: string | null;
  categoriaId: string | null;
  grupo: GrupoDeDocumento | null;
  // Nome do cartão em "Outros projetos"; só existe com grupo "arquivo".
  rotulo: string | null;
  liberarAutomatico: boolean;
  ativa: boolean;
};

export type CategoriaDaPasta = { id: string; nome: string };
export type ProjetoDaPasta = { id: string; nome: string; modeloNome: string | null; categorias: CategoriaDaPasta[] };

// "sem-codigo": o empreendimento não tem código de pasta. "sem-arvore": o conector nunca informou pastas para este código.
export type ArvoreDaPasta =
  | { situacao: "sem-codigo" | "sem-arvore" }
  | { situacao: "ok"; pastas: string[]; atualizadoEm: string | null };

export type DadosDaPasta = {
  etapasModo: ModoDeEtapas;
  regras: RegraDePasta[];
  projetos: ProjetoDaPasta[];
  arvore: ArvoreDaPasta;
  // null quando a configuração não pôde ser lida; o texto da tela não afirma nada nesse caso.
  liberacaoGeral: boolean | null;
};
