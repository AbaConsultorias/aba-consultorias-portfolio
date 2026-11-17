"use client";
import { atualizarSchema } from "@/app/api/(modules)/adm-interno/portal/fornecedor-documentos/schema";
import { FormularioFornecedor, requisitar } from "@/components/portal/fornecedor/formulario";
export function RevisarDocumento({ id, adminPath }: { id: string; adminPath: string }) {
  return <FormularioFornecedor schema={atualizarSchema} campos={[{ nome: "status", rotulo: "Decisão", tipo: "select", opcoes: [{ valor: "aprovado", nome: "Aprovar" }, { valor: "recusado", nome: "Recusar" }] }, { nome: "motivo", rotulo: "Motivo da recusa", tipo: "longo", ajuda: "Obrigatório para recusar. O fornecedor verá este motivo." }]} valores={{ id, status: "", motivo: "" }} salvar={(dados) => requisitar(`/${adminPath}/api/portal/fornecedor-documentos`, "PATCH", dados)} rotulo="Concluir revisão" decisao={{ campo: "status", aprovar: "aprovado", recusar: "recusado" }} />;
}
