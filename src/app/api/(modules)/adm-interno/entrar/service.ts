import { ForbiddenError, TooManyRequestsError } from "../../../HttpErrors";
import { obterAdminPath } from "@/lib/auth/admin-path";
import { destinoAposLogin } from "@/lib/auth/destino";
import { entrarComSenha } from "@/lib/auth/login";
import { PAPEIS_STAFF } from "@/lib/auth/papeis";
import { chaveConta, chaveIp, limitar } from "@/lib/rate-limit";
import type { EntrarAdminInput } from "./schema";

// O login de staff só aceita e-mail, então a mensagem não cita usuário.
const CREDENCIAIS_INVALIDAS = "E-mail ou senha inválidos.";

export async function entrarAdmin(
  { email, senha }: EntrarAdminInput,
  request: Request,
) {
  // Sem ADMIN_PATH o proxy nem reescreve até aqui; checar de novo é só
  // garantia de que a rota nunca atende "aberta".
  if (!obterAdminPath()) {
    throw new ForbiddenError("Acesso negado.");
  }

  const emailNormalizado = email.toLowerCase();

  // A equipe de um escritório sai pelo mesmo IP e toda entrada conta, mesmo com a senha certa: o limite
  // apertado fica no par IP e conta; o do IP sozinho só barra quem tenta muitas contas.
  const dentroDoLimite =
    (await limitar(chaveIp(request, "entrar-staff-ip"), 30, 60 * 60)) &&
    (await limitar(chaveIp(request, "entrar-staff", emailNormalizado), 5, 15 * 60)) &&
    (await limitar(chaveConta("entrar-staff-conta", emailNormalizado), 20, 60 * 60));

  if (!dentroDoLimite) {
    throw new TooManyRequestsError("Muitas tentativas. Tente novamente mais tarde.");
  }

  const perfil = await entrarComSenha(
    emailNormalizado,
    senha,
    PAPEIS_STAFF,
    CREDENCIAIS_INVALIDAS,
  );

  return { destino: destinoAposLogin(perfil) };
}
