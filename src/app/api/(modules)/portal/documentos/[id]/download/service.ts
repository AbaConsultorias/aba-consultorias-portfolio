import "server-only";
import { entregarArquivoPrivado } from "@/lib/portal/comum/arquivos";
import { paramsSchema } from "./schema";

// Id inválido segue o mesmo caminho do ausente: o helper responde o 404 padrão, com os mesmos cabeçalhos.
export function baixar(request: Request, params: unknown): Promise<Response> {
  const resultado = paramsSchema.safeParse(params);
  return entregarArquivoPrivado(request, "documento", resultado.success ? resultado.data.id : "");
}
