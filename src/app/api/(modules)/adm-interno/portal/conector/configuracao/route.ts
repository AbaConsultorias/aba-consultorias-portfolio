import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { alterarSchema } from "./schema";
import { alterarConfiguracao, obterConfiguracao } from "./service";

// Interruptor geral da liberação automática: desligado, nenhuma regra libera sozinha. Só o admin muda; quem tem servidor.regras lê.
export async function GET() {
  try {
    await autorizarPortal("leitura", "servidor.regras");
    return handleResponse({ message: "Configuração carregada.", details: await obterConfiguracao(), status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function PATCH(request: Request) {
  try {
    await autorizarPortal("escrita", "so-admin");
    const data = validation({ data: await lerJsonLimitado(request, 1024), schema: alterarSchema });
    const details = await alterarConfiguracao(data);
    invalidarPortal();
    return handleResponse({ message: "Configuração salva.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
