import { createClient } from "@supabase/supabase-js";

// O pacote `server-only` não está instalado; este throw cumpre o mesmo
// papel: a secret key ignora o RLS e nunca pode ir parar no navegador.
if (typeof window !== "undefined") {
  throw new Error("src/lib/supabase/admin.ts só pode ser usado no servidor.");
}

// Client com a secret key: ignora o RLS por completo. Só para tarefas que
// não pertencem a um usuário (criar conta, limpar precisa_trocar_senha,
// rate limit). Ver docs/SECURITY.md, regra 4.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY ausente.");
  }

  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
