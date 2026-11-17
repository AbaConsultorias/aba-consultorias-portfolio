import { notFound, redirect } from "next/navigation";
import { ForbiddenError, UnauthorizedError } from "@/app/api/HttpErrors";
import { obterAdminPath } from "./admin-path";
import { destinoAposLogin } from "./destino";
import { ehStaff, type Papel } from "./papeis";
import { obterAcessoAtual } from "./sessao";

type OpcoesPagina = {
  semAcesso: "entrar" | "404";
  // Só as próprias telas de troca de senha liberam isto; senão o guard
  // mandaria a pessoa para a tela de trocar senha em loop.
  permitirTrocaSenhaPendente?: boolean;
};

// Para páginas e layouts. Chame antes de devolver qualquer JSX.
export async function exigirPapel(
  papeis: readonly Papel[],
  { semAcesso, permitirTrocaSenhaPendente = false }: OpcoesPagina,
) {
  const acesso = await obterAcessoAtual();

  if (!acesso || !acesso.perfil.ativo || !papeis.includes(acesso.perfil.papel)) {
    return semAcesso === "404" ? notFound() : redirect("/entrar");
  }

  const { perfil } = acesso;

  if (perfil.precisa_trocar_senha && !permitirTrocaSenhaPendente) {
    if (ehStaff(perfil.papel) && !obterAdminPath()) notFound();
    redirect(destinoAposLogin(perfil));
  }

  return acesso;
}

type OpcoesApi = { permitirTrocaSenhaPendente?: boolean };

// Para route.ts. Layout e proxy não protegem uma rota de API: cada rota
// confere o papel de novo, no servidor.
export async function exigirPapelApi(
  papeis: readonly Papel[],
  { permitirTrocaSenhaPendente = false }: OpcoesApi = {},
) {
  const acesso = await obterAcessoAtual();

  if (!acesso) {
    throw new UnauthorizedError("Sessão inválida.");
  }

  const { perfil } = acesso;

  if (!perfil.ativo || !papeis.includes(perfil.papel)) {
    throw new ForbiddenError("Acesso negado.");
  }

  if (perfil.precisa_trocar_senha && !permitirTrocaSenhaPendente) {
    throw new ForbiddenError("Troque sua senha antes de continuar.");
  }

  return acesso;
}
