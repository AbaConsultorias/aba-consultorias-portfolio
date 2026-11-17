import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { lerPerfil } from "./perfil";

// Sessão validada no servidor (getUser confere o token com o Supabase, ao
// contrário de ler o cookie) + o próprio perfil. cache() deduplica a chamada
// entre layout e página na mesma requisição.
export const obterAcessoAtual = cache(async () => {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const perfil = await lerPerfil(supabase, user.id);
  if (!perfil) return null;

  return { user, perfil };
});
