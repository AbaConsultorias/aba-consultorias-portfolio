import "server-only";
import { revalidatePath } from "next/cache";
import { TooManyRequestsError } from "@/app/api/HttpErrors";
import { exigirRegraApi } from "@/lib/auth/permissoes-servidor";
import type { RegraAcesso } from "@/lib/auth/regras";
import { limitar } from "@/lib/rate-limit";

const LIMITES = {
  leitura: [120, 60],
  escrita: [60, 60],
  assinar: [30, 600],
  confirmar: [60, 600],
  download: [120, 60],
  foto: [600, 60],
  criar_conta: [10, 3600],
  enviar_relato: [20, 3600],
  enviar_documento: [30, 3600],
} as const;

export type AcaoPortal = keyof typeof LIMITES;
export type AcessoPortal = Awaited<ReturnType<typeof exigirRegraApi>>;

export async function autorizarPortal(acao: AcaoPortal, regra: RegraAcesso): Promise<AcessoPortal> {
  const acesso = await exigirRegraApi(regra);
  const [limite, janela] = LIMITES[acao];
  if (!await limitar(`portal:${acao}:${acesso.user.id}`, limite, janela, { falhaAberta: false })) {
    throw new TooManyRequestsError("Muitas solicitações. Aguarde e tente novamente.");
  }
  return acesso;
}

export function invalidarPortal(): void {
  revalidatePath("/cliente", "layout");
  revalidatePath("/empreiteiro", "layout");
  revalidatePath("/fornecedor", "layout");
  revalidatePath("/adm-interno/(protegido)/portal", "layout");
}
