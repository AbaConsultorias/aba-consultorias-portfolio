import { TooManyRequestsError } from "../../HttpErrors";
import { destinoAposLogin } from "@/lib/auth/destino";
import { entrarComSenha } from "@/lib/auth/login";
import { PAPEIS_USUARIO } from "@/lib/auth/papeis";
import { chaveConta, chaveIp, limitar } from "@/lib/rate-limit";
import type { EntrarInput } from "./schema";

const DOMINIO_USUARIOS = "acesso.abaconsultorias.com.br";
const CREDENCIAIS_INVALIDAS = "E-mail/usuário ou senha inválidos.";

// Usuário sem "@" vira o e-mail interno usado nas contas de cliente,
// empreiteiro e fornecedor.
function identificadorParaEmail(identificador: string) {
  const valor = identificador.toLowerCase();
  return valor.includes("@") ? valor : `${valor}@${DOMINIO_USUARIOS}`;
}

export async function entrar(
  { identificador, senha }: EntrarInput,
  request: Request,
) {
  const email = identificadorParaEmail(identificador);

  const dentroDoLimite =
    (await limitar(chaveIp(request, "entrar-ip"), 30, 60 * 60)) &&
    (await limitar(chaveIp(request, "entrar", email), 5, 15 * 60)) &&
    (await limitar(chaveConta("entrar-conta", email), 20, 60 * 60));

  if (!dentroDoLimite) {
    throw new TooManyRequestsError("Muitas tentativas. Tente novamente mais tarde.");
  }

  const perfil = await entrarComSenha(
    email,
    senha,
    PAPEIS_USUARIO,
    CREDENCIAIS_INVALIDAS,
  );

  return { destino: destinoAposLogin(perfil) };
}
