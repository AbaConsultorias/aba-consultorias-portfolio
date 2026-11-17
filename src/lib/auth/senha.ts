import { createClient } from "@supabase/supabase-js";

// Confere a senha atual sem mexer na sessão do navegador: usa um client
// descartável (sem cookies, sem persistência) e encerra a sessão que o
// login cria, para não deixar token sobrando.
export async function senhaConfere(email: string, senha: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Variáveis do Supabase ausentes.");
  }

  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error || !data.session) {
    if (!error?.status || error.status >= 500) {
      throw new Error(`Falha ao conferir a senha (${error?.code ?? "sem código"}).`);
    }
    return false;
  }

  await supabase.auth.signOut({ scope: "local" });
  return true;
}
