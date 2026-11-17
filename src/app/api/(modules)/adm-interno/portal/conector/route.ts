import { lerJsonLimitado } from "@/app/api/utils/corpo";
import { handleError } from "@/app/api/utils/handleError";
import { handleResponse } from "@/app/api/utils/handleResponse";
import { validation } from "@/app/api/utils/validation";
import { autorizarPortal, invalidarPortal } from "@/lib/portal/comum/servidor";
import { createClient } from "@/lib/supabase/server";
import { emitirSchema } from "./schema";
import { emitirChave, estadoDoConector, revogarChave } from "./service";

// Chave de servidor do conector: só o papel admin (a equipe não emite nem revoga; o RLS também recusa).
export async function GET() {
  try {
    await autorizarPortal("leitura", "so-admin");
    const details = await estadoDoConector(await createClient());
    return handleResponse({ message: "Conector carregado.", details, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function POST(request: Request) {
  try {
    await autorizarPortal("escrita", "so-admin");
    const data = validation({ data: (await lerJsonLimitado(request, 1024)) ?? {}, schema: emitirSchema });
    const details = await emitirChave(data, await createClient());
    invalidarPortal();
    return handleResponse({ message: "Chave emitida. Ela só aparece agora: copie e guarde.", details, status: 201 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}

export async function DELETE() {
  try {
    await autorizarPortal("escrita", "so-admin");
    await revogarChave(await createClient());
    invalidarPortal();
    return handleResponse({ message: "Chave revogada.", details: null, status: 200 });
  } catch (error) {
    return handleResponse(handleError(error));
  }
}
