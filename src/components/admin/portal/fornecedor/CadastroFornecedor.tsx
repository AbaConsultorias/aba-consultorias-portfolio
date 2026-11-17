"use client";
import { Plus, Save } from "lucide-react";
import { criarSchema, atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/fornecedores/schema";
import { FormularioFornecedor, requisitar, type CampoFornecedor } from "@/components/portal/fornecedor/formulario";
import type { FornecedorAdmin } from "@/lib/portal/fornecedor/tipos";
const campos: CampoFornecedor[] = [
  { nome: "razaoSocial", rotulo: "Razão social" }, { nome: "nomeFantasia", rotulo: "Nome fantasia (opcional)", nullable: true },
  { nome: "cnpj", rotulo: "CNPJ (opcional)", nullable: true, ajuda: "Aceita 14 dígitos ou o formato 00.000.000/0000-00." },
  { nome: "contatoNome", rotulo: "Pessoa de contato", nullable: true }, { nome: "telefone", rotulo: "Telefone", nullable: true },
  { nome: "email", rotulo: "E-mail", nullable: true }, { nome: "observacao", rotulo: "Observação para o fornecedor", tipo: "longo", nullable: true, ajuda: "Esta observação é visível ao próprio fornecedor. Não inclua informações internas ou de clientes." },
  { nome: "ativo", rotulo: "Fornecedor ativo", tipo: "boolean" },
];
export function CadastroFornecedor({ adminPath, fornecedor }: { adminPath: string; fornecedor?: FornecedorAdmin }) {
  const valores = fornecedor ? { ...fornecedor } : { razaoSocial: "", nomeFantasia: null, cnpj: null, contatoNome: null, telefone: null, email: null, observacao: null, ativo: true };
  return <FormularioFornecedor schema={fornecedor ? atualizarSchema : criarSchema} campos={campos} valores={valores} salvar={(dados) => requisitar(`/${adminPath}/api/portal/fornecedores`, fornecedor ? "PATCH" : "POST", dados)} rotulo={fornecedor ? "Salvar cadastro" : "Cadastrar fornecedor"} limpar={!fornecedor} Icone={fornecedor ? Save : Plus} />;
}
