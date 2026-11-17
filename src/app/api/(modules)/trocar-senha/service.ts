import { isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import {
  BadRequestError,
  InternalServerError,
  TooManyRequestsError,
} from "../../HttpErrors";
import { destinoAposLogin } from "@/lib/auth/destino";
import type { Perfil } from "@/lib/auth/perfil";
import { senhaConfere } from "@/lib/auth/senha";
import { limitar } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { TrocarSenhaInput } from "./schema";

export async function trocarSenha(
  { senhaAtual, novaSenha }: TrocarSenhaInput,
  { user, perfil }: { user: User; perfil: Perfil },
) {
  if (!user.email) {
    throw new InternalServerError(null);
  }

  if (!(await limitar(`trocar-senha:${user.id}`, 5, 15 * 60))) {
    throw new TooManyRequestsError("Muitas tentativas. Tente novamente mais tarde.");
  }

  if (!(await senhaConfere(user.email, senhaAtual))) {
    throw new BadRequestError({
      senhaAtual: { errors: ["Senha atual incorreta."] },
    });
  }

  // Client admin: a troca vale só para o user.id da sessão já validada no
  // route.ts, e profiles não tem política de update para o próprio usuário.
  const admin = createAdminClient();

  const { error: erroSenha } = await admin.auth.admin.updateUserById(user.id, {
    password: novaSenha,
  });

  if (erroSenha) {
    console.error("[trocar-senha] erro ao atualizar a senha:", erroSenha.code);
    if (erroSenha.code === "weak_password") {
      throw new BadRequestError({
        novaSenha: { errors: ["Essa senha é fraca demais. Escolha outra."] },
      });
    }
    throw new InternalServerError(null);
  }

  // A troca de senha invalida as sessões da conta, inclusive a atual. Por
  // isso: derruba todas (um invasor que entrou com a senha antiga cai junto)
  // logo após a troca, antes de qualquer outra escrita, e abre uma sessão nova
  // com a senha nova, para quem trocou seguir logado.
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const { error: erroSessoes } = await admin.auth.admin.signOut(
      session.access_token,
      "global",
    );
    // Sessão ausente é o resultado esperado: a troca de senha já a encerrou.
    if (erroSessoes && erroSessoes.status !== 404 && !isAuthSessionMissingError(erroSessoes)) {
      console.error("[trocar-senha] erro ao encerrar sessões:", erroSessoes.code);
      throw new InternalServerError(null);
    }
  }

  const { error: erroPerfil } = await admin
    .from("profiles")
    .update({ precisa_trocar_senha: false })
    .eq("id", user.id);

  if (erroPerfil) {
    console.error("[trocar-senha] erro ao limpar o aviso:", erroPerfil.code);
    throw new InternalServerError(null);
  }

  const { error: erroLogin } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: novaSenha,
  });

  if (erroLogin) {
    console.error("[trocar-senha] erro ao abrir a sessão nova:", erroLogin.code);
    throw new InternalServerError(null);
  }

  return {
    destino: destinoAposLogin({ papel: perfil.papel, precisa_trocar_senha: false }),
  };
}
