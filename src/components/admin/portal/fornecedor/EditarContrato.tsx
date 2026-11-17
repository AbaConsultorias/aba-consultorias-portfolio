"use client";
import { atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/fornecedor-contratos/schema";
import { FormularioFornecedor, requisitar } from "@/components/portal/fornecedor/formulario";
import type { ContratoFornecedorAdmin } from "@/lib/portal/fornecedor/tipos";
export function EditarContrato({ contrato, empreendimentos, adminPath }: { contrato: ContratoFornecedorAdmin; empreendimentos: { id: string; nome: string }[]; adminPath: string }) {
  return <details className="forn-caixa"><summary>Editar {contrato.titulo}</summary><FormularioFornecedor schema={atualizarSchema} campos={[{ nome: "titulo", rotulo: "Título" }, { nome: "empreendimentoId", rotulo: "Empreendimento (opcional)", tipo: "select", nullable: true, opcoes: empreendimentos.map((e) => ({ valor: e.id, nome: e.nome })) }]} valores={{ id: contrato.id, titulo: contrato.titulo, empreendimentoId: contrato.empreendimentoId }} salvar={(dados) => requisitar(`/${adminPath}/api/portal/fornecedor-contratos`, "PATCH", dados)} /></details>;
}
