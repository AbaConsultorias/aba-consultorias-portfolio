import "server-only";
import { entregarArquivoPrivado } from "@/lib/portal/comum/arquivos";
export const baixar = (request: Request, id: string) => entregarArquivoPrivado(request, "fornecedor_contrato", id);

