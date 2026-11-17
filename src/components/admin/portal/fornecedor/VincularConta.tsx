"use client";
import { Link2 } from "lucide-react";
import { criarSchema } from "@/app/api/(modules)/adm-interno/portal/fornecedor-usuarios/schema";
import { FormularioFornecedor, requisitar } from "@/components/portal/fornecedor/formulario";
import type { ContaPortal } from "@/lib/portal/comum/contas";
export function VincularConta({ fornecedorId, contas, adminPath }: { fornecedorId: string; contas: ContaPortal[]; adminPath: string }) {
  return <FormularioFornecedor schema={criarSchema} campos={[{ nome: "profileId", rotulo: "Conta do fornecedor", tipo: "select", opcoes: contas.map((c) => ({ valor: c.id, nome: `${c.nome}${c.ativo ? "" : " (inativa)"}` })) }]} valores={{ fornecedorId, profileId: "" }} salvar={(dados) => requisitar(`/${adminPath}/api/portal/fornecedor-usuarios`, "POST", dados)} rotulo="Vincular conta" limpar Icone={Link2} />;
}
