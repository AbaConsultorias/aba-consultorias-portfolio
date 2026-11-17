import type { UUID } from "../comum/tipos";

// Contratos e orçamentos do empreendimento (sem projeto): viram seções próprias para o cliente (contrato §7, D8).
// "arquivo": PDFs de projetos que não existem no site (Urbanístico, Drenagem...); um cartão por pastaRotulo no bloco
// "Outros projetos" (docs/PASTAS-SES-ARQUIVO-CONTRATO.md).
export type GrupoDocumento = "contratos" | "orcamentos" | "arquivo";

// SIMO e Laudo de um equipamento (regra de pasta "equipamentos"); documento comum tem os dois campos nulos.
export type PapelDeEquipamento = "simo" | "laudo";

export type DocumentoPortal = {
  id: UUID;
  titulo: string;
  projetoId: UUID | null;
  categoriaId: UUID | null;
  grupo: GrupoDocumento | null;
  // Nome do cartão em "Outros projetos"; só existe com grupo "arquivo".
  pastaRotulo: string | null;
  tamanho: number;
  liberadoEm: string | null;
  equipamento: string | null;
  equipamentoPapel: PapelDeEquipamento | null;
  downloadHref: string;
};

export type DocumentoAdmin = {
  id: UUID;
  empreendimentoId: UUID;
  projetoId: UUID | null;
  categoriaId: UUID | null;
  grupo: GrupoDocumento | null;
  pastaRotulo: string | null;
  titulo: string;
  mime: string;
  tamanho: number;
  sha256: string | null;
  liberadoCliente: boolean;
  liberadoEm: string | null;
  criadoEm: string;
  equipamento: string | null;
  equipamentoPapel: PapelDeEquipamento | null;
};

export type ProjetoDocumento = { id: UUID; nome: string; projetoPaiId?: UUID | null; ordem?: number };
export type CategoriaDocumento = { id: UUID; projetoId: UUID; nome: string; ordem: number };
export type EstruturaDocumentos = { projetos: ProjetoDocumento[]; categorias: CategoriaDocumento[] };

export type DownloadDocumento = {
  id: UUID;
  profileId: UUID | null;
  nome: string | null;
  em: string;
  origem: string | null;
};

export type DocumentoAgrupavel = Pick<DocumentoPortal, "projetoId" | "categoriaId"> & { grupo?: GrupoDocumento | null; pastaRotulo?: string | null };

export type GrupoDocumentos<T extends DocumentoAgrupavel = DocumentoPortal> = {
  chave: string;
  projetoId: UUID | null;
  grupo: GrupoDocumento | null;
  pastaRotulo: string | null;
  categoriaId: UUID | null;
  projeto: string | null;
  categoria: string | null;
  documentos: T[];
};

export type ProjetoDocumentos<T extends DocumentoAgrupavel = DocumentoPortal> = {
  // Chave estável do cartão: o id do projeto, "grupo:contratos", "grupo:orcamentos", "arquivo:<rótulo>" ou "gerais".
  chave: string;
  projetoId: UUID | null;
  grupo: GrupoDocumento | null;
  nome: string;
  quantidade: number;
  categorias: GrupoDocumentos<T>[];
};
