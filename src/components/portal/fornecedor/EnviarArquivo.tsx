"use client";
import { useRef, useState } from "react";
import { Eraser, Upload } from "lucide-react";
import z from "zod";
import { Button } from "@/components/ui/button";
import { assinarSchema as documentoSchema } from "@/app/api/(modules)/portal/fornecedor/documentos/upload/schema";
import { assinarSchema as contratoSchema } from "@/app/api/(modules)/adm-interno/portal/fornecedor-contratos/upload/schema";
import { enviarArquivoAssinado } from "@/components/portal/comum/enviarArquivoAssinado";
import { LIMITE_ARQUIVO_FORNECEDOR, MIMES_FORNECEDOR, ROTULOS_DOCUMENTO, TIPOS_DOCUMENTO } from "@/lib/portal/fornecedor/regras";
import { FormularioFornecedor, requisitar, type CampoFornecedor } from "./formulario";

const arquivoSchema = z.custom<File>((v) => typeof File !== "undefined" && v instanceof File, "Selecione um arquivo.").refine((v) => v instanceof File && v.size > 0 && v.size <= LIMITE_ARQUIVO_FORNECEDOR, "O arquivo deve ter entre 1 byte e 20 MiB.");
const respostaSchema = z.object({ signedUrl: z.url(), comprovante: z.string() });
type Opcao = { valor: string; nome: string };
export function EnviarArquivo({ fornecedores, empreendimentos, contrato = false, adminPath }: {
  fornecedores: Opcao[]; empreendimentos: (Opcao & { fornecedorId?: string })[]; contrato?: boolean; adminPath?: string;
}) {
  const [etapa, setEtapa] = useState("");
  const [versao, setVersao] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const tentativa = useRef<{ arquivo: File; chave: string; comprovante: string } | null>(null);
  const schema = (contrato ? contratoSchema.omit({ tamanho: true }) : documentoSchema.omit({ mime: true, tamanho: true })).extend({
    arquivo: arquivoSchema.refine((v) => v instanceof File && (contrato ? v.type === "application/pdf" : (MIMES_FORNECEDOR as readonly string[]).includes(v.type)), contrato ? "Selecione um PDF." : "Selecione um PDF, JPEG ou PNG."),
  });
  const campos: CampoFornecedor[] = [
    { nome: "fornecedorId", rotulo: "Fornecedor", tipo: "select", opcoes: fornecedores },
    ...(!contrato ? [{ nome: "tipo", rotulo: "Tipo de documento", tipo: "select" as const, opcoes: TIPOS_DOCUMENTO.map((tipo) => ({ valor: tipo, nome: ROTULOS_DOCUMENTO[tipo] })) }] : []),
    { nome: "titulo", rotulo: "Título" },
    { nome: "empreendimentoId", rotulo: "Empreendimento (opcional)", tipo: "select", nullable: true, filtrarFornecedor: !contrato, opcoes: empreendimentos, ajuda: contrato ? "O contrato pode ser cadastrado antes do financeiro." : "Escolha um empreendimento com item do fornecedor selecionado ou deixe em branco." },
    { nome: "arquivo", rotulo: contrato ? "Contrato em PDF" : "Arquivo", tipo: "arquivo", accept: contrato ? "application/pdf,.pdf" : "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png", ajuda: "Até 20 MiB." },
  ];
  async function enviar(dados: Record<string, unknown>) {
    const arquivo = arquivoSchema.parse(dados.arquivo);
    const entrada = (contrato ? contratoSchema : documentoSchema).parse({ ...dados, tamanho: arquivo.size, mime: arquivo.type });
    if (!contrato && entrada.empreendimentoId && !empreendimentos.some((e) => e.valor === entrada.empreendimentoId && e.fornecedorId === entrada.fornecedorId)) throw new Error("Escolha um empreendimento do fornecedor selecionado.");
    const endpoint = contrato ? `/${adminPath}/api/portal/fornecedor-contratos/upload` : "/api/portal/fornecedor/documentos/upload";
    const chave = JSON.stringify(entrada);
    setOcupado(true);
    try {
      if (!tentativa.current || tentativa.current.arquivo !== arquivo || tentativa.current.chave !== chave) {
        setEtapa("Preparando o envio…");
        const assinatura = respostaSchema.parse(await requisitar(`${endpoint}/assinar`, "POST", entrada));
        setEtapa("Enviando arquivo…");
        await enviarArquivoAssinado({ signedUrl: assinatura.signedUrl, arquivo, mime: arquivo.type });
        tentativa.current = { arquivo, chave, comprovante: assinatura.comprovante };
      }
      setEtapa("Conferindo o arquivo…");
      await requisitar(`${endpoint}/confirmar`, "POST", { comprovante: tentativa.current.comprovante });
      tentativa.current = null;
      setVersao((v) => v + 1);
      setEtapa(contrato ? "Contrato disponível para o fornecedor." : "Documento enviado. Aguarde a revisão da equipe.");
    } catch (error) { setEtapa(tentativa.current ? "Envio não concluído. Tente novamente; a confirmação usa o mesmo envio." : "Envio não concluído. Tente novamente."); throw error; }
    finally { setOcupado(false); }
  }
  return <section className="forn-caixa">
    <h2>{contrato ? "Enviar contrato" : "Enviar documento"}</h2>
    <FormularioFornecedor key={versao} schema={schema} campos={campos} valores={{ fornecedorId: fornecedores[0]?.valor ?? "", titulo: "", empreendimentoId: null, tipo: "nota_fiscal", arquivo: null }} salvar={enviar} rotulo="Enviar arquivo" Icone={Upload} />
    <p aria-live="polite" className="forn-mensagem">{etapa}</p>
    <Button variant="outline" className="portal-botao" type="button" disabled={ocupado} onClick={() => { tentativa.current = null; setVersao((v) => v + 1); setEtapa(""); }}><Eraser size={18} aria-hidden="true" />Limpar e iniciar novo envio</Button>
  </section>;
}
