import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { autorizarPortal } from "@/lib/portal/comum/servidor";
import { consultarUso } from "./service";

// Soma o balde do R2 (resultado em cache por 1 h): o painel avisa a partir de 8 GB dos 10 GB gratuitos.
export async function GET() {
  try {
    await autorizarPortal("leitura", "painel.servidor");
    return handleResponse({ message: "Uso do armazenamento carregado.", details: await consultarUso(), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
