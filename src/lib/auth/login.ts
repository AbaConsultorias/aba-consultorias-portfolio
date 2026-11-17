import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { InternalServerError, UnauthorizedError } from "@/app/api/HttpErrors";
import { createClient } from "@/lib/supabase/server";
import type { Papel } from "./papeis";
import { lerPerfil } from "./perfil";

const ID_INEXISTENTE = "00000000-0000-0000-0000-000000000000";

function variaveisDoSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Variáveis do Supabase ausentes.");
  }

  return { url, publishableKey };
}

// Client descartável: sem cookies e sem persistência, para a sessão só
// chegar ao navegador depois de a conta ser aprovada.
function criarClientDescartavel(accessToken?: string) {
  const { url, publishableKey } = variaveisDoSupabase();

  return createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
}

// Senha errada gasta o mesmo que uma conta recusada (leitura de perfil +
// uma chamada ao Auth); sem isso, o tempo de resposta revelaria quais
// senhas de staff estão certas.
async function igualarCustoDaRecusa() {
  const supabase = criarClientDescartavel();

  await lerPerfil(supabase, ID_INEXISTENTE);
  await supabase.auth.getUser("token-invalido");
}

// credenciaisInvalidas: uma mensagem só para senha errada, conta inexistente,
// conta inativa e área errada — diferenciar ajudaria quem tenta descobrir
// quais contas existem.
export async function entrarComSenha(
  email: string,
  senha: string,
  papeisPermitidos: readonly Papel[],
  credenciaisInvalidas: string,
) {
  const descartavel = criarClientDescartavel();

  const { data, error } = await descartavel.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error || !data.user || !data.session) {
    if (!error?.status || error.status >= 500) {
      console.error("[login] falha no Supabase:", error?.code, error?.status);
      throw new InternalServerError(null);
    }
    // Qualquer recusa que não seja senha errada (ex: provedor de e-mail
    // desligado no Supabase) continua genérica para o usuário, mas fica no log.
    if (error?.code !== "invalid_credentials") {
      console.error("[login] recusa inesperada do Supabase:", error?.code, error?.status);
    }
    await igualarCustoDaRecusa();
    throw new UnauthorizedError(credenciaisInvalidas);
  }

  const { access_token, refresh_token } = data.session;
  const perfil = await lerPerfil(criarClientDescartavel(access_token), data.user.id);

  if (!perfil || !perfil.ativo || !papeisPermitidos.includes(perfil.papel)) {
    // scope local: encerra só esta sessão, sem derrubar as outras da mesma
    // conta (ex: staff que tentou entrar pela tela de usuário).
    await descartavel.auth.signOut({ scope: "local" });
    throw new UnauthorizedError(credenciaisInvalidas);
  }

  const supabase = await createClient();
  const { error: erroSessao } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (erroSessao) {
    console.error("[login] falha ao gravar a sessão:", erroSessao.code);
    await descartavel.auth.signOut({ scope: "local" });
    throw new InternalServerError(null);
  }

  return perfil;
}
