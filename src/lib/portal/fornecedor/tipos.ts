import type { UUID } from "../comum/tipos";
import type { ItemFinanceiroPortal, ParcelaPortal } from "../financeiro/tipos";
import type { TIPOS_DOCUMENTO } from "./regras";

export type FornecedorPortal = { id: UUID; nome: string; razaoSocial: string; cnpj: string | null; observacao: string | null };
export type FornecedorAdmin = FornecedorPortal & { nomeFantasia: string | null; contatoNome: string | null; telefone: string | null; email: string | null; ativo: boolean };
export type ItemFornecedor = Omit<ItemFinanceiroPortal, "parcelas" | "projetos"> & { empreendimentoId: UUID; empreendimentoNome: string | null; parcelas: (ParcelaPortal & { observacao: string | null })[] };
export type ContratoFornecedor = { id: UUID; fornecedorId: UUID; titulo: string; empreendimentoNome: string | null; tamanho: number; criadoEm: string; downloadHref: string };
export type ContratoFornecedorAdmin = ContratoFornecedor & { empreendimentoId: UUID | null };
export type StatusDocumento = "pendente" | "aprovado" | "recusado";
export type DocumentoFornecedor = ContratoFornecedor & { tipo: typeof TIPOS_DOCUMENTO[number]; status: StatusDocumento; motivo: string | null; revisadoEm: string | null };
