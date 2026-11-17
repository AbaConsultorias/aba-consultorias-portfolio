import "server-only";
import type z from "zod";
import { listarContas, criarConta, atualizarConta } from "@/lib/portal/comum/contas";
import type * as schemas from "./schema";

export { identificadorParaEmail as identificadorClienteParaEmail } from "@/lib/portal/comum/contas";

export async function listar(entrada: z.infer<typeof schemas.consultaSchema>) {
  const pagina = await listarContas("cliente", entrada);
  return { ...pagina, registros: pagina.registros.map(({ precisaTrocarSenha, ...conta }) => ({ ...conta, precisa_trocar_senha: precisaTrocarSenha })) };
}

export function criar(entrada: z.infer<typeof schemas.criarSchema>, atorId: string) {
  return criarConta("cliente", entrada, atorId);
}

export function atualizar(entrada: z.infer<typeof schemas.atualizarSchema>, atorId: string) {
  return atualizarConta("cliente", entrada, atorId);
}
