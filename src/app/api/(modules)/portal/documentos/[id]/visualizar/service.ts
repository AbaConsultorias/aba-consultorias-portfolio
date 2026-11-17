import "server-only";
import { entregarVisualizacaoDeSimo } from "@/lib/portal/comum/arquivos";
import { paramsSchema } from "./schema";

// Id inválido segue o mesmo caminho do ausente: o helper responde o 404 padrão, com os mesmos cabeçalhos.
export function visualizar(request: Request, params: unknown): Promise<Response> {
  const resultado = paramsSchema.safeParse(params);
  return entregarVisualizacaoDeSimo(request, resultado.success ? resultado.data.id : "");
}
